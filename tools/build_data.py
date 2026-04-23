"""
构建量化基金看板所需的 JSON 数据。
读取 Wind 导出的 xlsx 原始数据，按量化口径筛选、聚合，输出到 quant-funds/data/。

数据口径（一期）：
- 私募基金：基金投资类型 ∈ {量化多头, 阿尔法策略, 股票多空, 股票市场中性,
                         其他市场中性, 管理期货, 套利策略, 趋势策略}
- 公募基金（股票型 + 混合型）：名称 或 业绩比较基准 含关键词
                               {量化, 指数增强, 对冲, 阿尔法}
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd


REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_SRC = Path(
    "/Users/zhuyuanqi/Desktop/实习/野草创投/模板/P01-专题/0420-量化指增筛选/原始数据-基金-wind-0421"
)
OUT_DIR = REPO_ROOT / "quant-funds" / "data"

PRIVATE_STRATEGY_WHITELIST = {
    "量化多头",
    "阿尔法策略",
    "股票多空",
    "股票市场中性",
    "其他市场中性",
    "管理期货",
    "套利策略",
    "趋势策略",
}

PUBLIC_KEYWORDS = ("量化", "指数增强", "对冲", "阿尔法")

STRATEGY_NORMALIZE = {
    "量化多头": "量化多头",
    "阿尔法策略": "阿尔法策略",
    "股票多空": "股票多空",
    "股票市场中性": "市场中性",
    "其他市场中性": "市场中性",
    "管理期货": "管理期货(CTA)",
    "套利策略": "套利策略",
    "趋势策略": "趋势策略",
}

RETURN_COLS = [
    "日回报",
    "近一周",
    "近一月",
    "近一季",
    "近半年",
    "近一年",
    "近两年",
    "年初至今",
    "成立以来",
    "年化回报",
]

PERIOD_LABELS = {
    "日回报": "日",
    "近一周": "近一周",
    "近一月": "近一月",
    "近一季": "近一季",
    "近半年": "近半年",
    "近一年": "近一年",
    "近两年": "近两年",
    "年初至今": "年初至今",
    "年化回报": "年化",
}


def _read_excel_safe(path: Path) -> pd.DataFrame:
    """安全读取 xlsx，优先 openpyxl，若遇样式错误则回退到 calamine。"""
    try:
        return pd.read_excel(path, sheet_name="file", engine="openpyxl")
    except Exception:
        try:
            return pd.read_excel(path, sheet_name="file", engine="calamine")
        except Exception as e:
            print(f"[WARN] 无法读取 {path.name}: {e}", file=sys.stderr)
            return pd.DataFrame()


def load_private() -> pd.DataFrame:
    df = _read_excel_safe(DATA_SRC / "私募基金.xlsx")
    if df.empty:
        return df
    df = df[df["基金投资类型"].isin(PRIVATE_STRATEGY_WHITELIST)].copy()
    df["策略"] = df["基金投资类型"].map(STRATEGY_NORMALIZE)
    df["来源"] = "私募"
    df["管理人"] = np.nan
    df["基金规模(亿元)"] = np.nan
    return df


def load_public() -> pd.DataFrame:
    frames = []
    for fname in ("股票型基金.xlsx", "混合型.xlsx"):
        df = _read_excel_safe(DATA_SRC / fname)
        if df.empty:
            continue
        name_hit = df["名称"].astype(str).str.contains(
            "|".join(PUBLIC_KEYWORDS), na=False
        )
        bm = df.get("业绩比较基准", pd.Series([""] * len(df)))
        bm_hit = bm.astype(str).str.contains("|".join(PUBLIC_KEYWORDS), na=False)
        mask = name_hit | bm_hit
        sub = df[mask].copy()
        sub["来源"] = "公募-" + fname.replace(".xlsx", "").replace("基金", "")

        def _classify(row: pd.Series) -> str:
            text = f"{row.get('名称', '')} {row.get('业绩比较基准', '')}"
            if "指数增强" in text or "增强指数" in text:
                return "公募指数增强"
            if "对冲" in text or "市场中性" in text:
                return "公募对冲/中性"
            if "阿尔法" in text:
                return "公募阿尔法"
            return "公募量化"

        sub["策略"] = sub.apply(_classify, axis=1)
        if "基金规模(亿元)" not in sub.columns:
            sub["基金规模(亿元)"] = np.nan
        if "管理人" not in sub.columns:
            sub["管理人"] = np.nan
        frames.append(sub)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True, sort=False)
    return out


def unify(priv: pd.DataFrame, pub: pd.DataFrame) -> pd.DataFrame:
    keep = [
        "代码",
        "名称",
        "策略",
        "来源",
        "管理人",
        "基金规模(亿元)",
        "现价",
        "累计净值",
        *RETURN_COLS,
        "时间",
    ]
    frames = []
    for df in (priv, pub):
        if df.empty:
            continue
        for col in keep:
            if col not in df.columns:
                df[col] = np.nan
        frames.append(df[keep])
    if not frames:
        return pd.DataFrame(columns=keep)
    out = pd.concat(frames, ignore_index=True, sort=False)

    for col in RETURN_COLS + ["现价", "累计净值", "基金规模(亿元)"]:
        out[col] = pd.to_numeric(out[col], errors="coerce")

    # Wind 原始字段为"小数比例"(0.05 = 5%)，此处统一乘 100 转为"百分比数值"
    # 下游（前端）直接当百分比使用，不再二次乘算
    for col in RETURN_COLS:
        out[col] = out[col] * 100
        out.loc[out[col].abs() > 50000, col] = np.nan

    out["时间"] = pd.to_datetime(out["时间"], errors="coerce")
    out = out[out["时间"] >= pd.Timestamp("2015-01-01")].copy()

    out = out.dropna(subset=["代码", "名称", "策略"])
    out = out.drop_duplicates(subset=["代码"], keep="first")
    return out.reset_index(drop=True)


def _pct_stats(series: pd.Series) -> dict:
    s = series.dropna()
    if s.empty:
        return {"count": 0, "mean": None, "median": None, "p25": None, "p75": None,
                "min": None, "max": None, "std": None, "win_rate": None}
    return {
        "count": int(s.size),
        "mean": round(float(s.mean()), 4),
        "median": round(float(s.median()), 4),
        "p25": round(float(s.quantile(0.25)), 4),
        "p75": round(float(s.quantile(0.75)), 4),
        "min": round(float(s.min()), 4),
        "max": round(float(s.max()), 4),
        "std": round(float(s.std()), 4),
        "win_rate": round(float((s > 0).mean()), 4),
    }


def build_overview(df: pd.DataFrame) -> dict:
    ytd = df["年初至今"].dropna()
    ann = df["年化回报"].dropna()
    daily = df["日回报"].dropna()
    n_strategy = df["策略"].nunique()
    snapshot_date = df["时间"].max()
    return {
        "asOf": snapshot_date.strftime("%Y-%m-%d") if pd.notna(snapshot_date) else "-",
        "totalFunds": int(len(df)),
        "privateFunds": int((df["来源"] == "私募").sum()),
        "publicFunds": int((df["来源"].str.startswith("公募")).sum()),
        "strategyCount": int(n_strategy),
        "ytdMean": round(float(ytd.mean()), 2) if not ytd.empty else None,
        "ytdMedian": round(float(ytd.median()), 2) if not ytd.empty else None,
        "ytdWinRate": round(float((ytd > 0).mean()) * 100, 2) if not ytd.empty else None,
        "annMean": round(float(ann.mean()), 2) if not ann.empty else None,
        "annMedian": round(float(ann.median()), 2) if not ann.empty else None,
        "annTop1pct": round(float(ann.quantile(0.99)), 2) if not ann.empty else None,
        "dailyMean": round(float(daily.mean()), 4) if not daily.empty else None,
        "dailyWinRate": round(float((daily > 0).mean()) * 100, 2) if not daily.empty else None,
    }


def build_strategy_stats(df: pd.DataFrame) -> list[dict]:
    rows = []
    for strategy, sub in df.groupby("策略"):
        row = {"strategy": strategy, "count": int(len(sub))}
        for col in RETURN_COLS:
            row[col] = _pct_stats(sub[col])
        rows.append(row)
    rows.sort(key=lambda r: r["count"], reverse=True)
    return rows


def build_heatmap(df: pd.DataFrame) -> dict:
    periods = ["近一周", "近一月", "近一季", "近半年", "近一年", "近两年", "年初至今", "年化回报"]
    strategies = [r for r, _ in df.groupby("策略")]
    strategies.sort(key=lambda s: -len(df[df["策略"] == s]))
    matrix = []
    for si, s in enumerate(strategies):
        sub = df[df["策略"] == s]
        for pi, p in enumerate(periods):
            val = sub[p].dropna().median()
            if pd.isna(val):
                matrix.append([pi, si, None])
            else:
                matrix.append([pi, si, round(float(val), 2)])
    return {
        "periods": [PERIOD_LABELS.get(p, p) for p in periods],
        "strategies": strategies,
        "matrix": matrix,
    }


def build_strategy_compare(df: pd.DataFrame) -> dict:
    periods = ["近一周", "近一月", "近一季", "近半年", "近一年", "年初至今", "年化回报"]
    strategies = sorted(df["策略"].unique().tolist(),
                        key=lambda s: -len(df[df["策略"] == s]))
    series = []
    for s in strategies:
        sub = df[df["策略"] == s]
        series.append({
            "name": s,
            "values": [
                round(float(sub[p].dropna().median()), 2)
                if not sub[p].dropna().empty else None
                for p in periods
            ],
        })
    return {
        "periods": [PERIOD_LABELS.get(p, p) for p in periods],
        "series": series,
    }


def build_top_movers(df: pd.DataFrame) -> dict:
    def _fmt(sub: pd.DataFrame, col: str, n: int = 10) -> list[dict]:
        s = sub.dropna(subset=[col]).nlargest(n, col)
        return [
            {
                "code": r["代码"],
                "name": r["名称"],
                "strategy": r["策略"],
                "source": r["来源"],
                "value": round(float(r[col]), 2),
            }
            for _, r in s.iterrows()
        ]

    def _bot(sub: pd.DataFrame, col: str, n: int = 10) -> list[dict]:
        s = sub.dropna(subset=[col]).nsmallest(n, col)
        return [
            {
                "code": r["代码"],
                "name": r["名称"],
                "strategy": r["策略"],
                "source": r["来源"],
                "value": round(float(r[col]), 2),
            }
            for _, r in s.iterrows()
        ]

    return {
        "ytd_top": _fmt(df, "年初至今", 15),
        "ytd_bot": _bot(df, "年初至今", 15),
        "ann_top": _fmt(df, "年化回报", 15),
        "y1_top": _fmt(df, "近一年", 15),
        "y1_bot": _bot(df, "近一年", 15),
    }


def build_all_funds(df: pd.DataFrame) -> list[dict]:
    cols = [
        "代码", "名称", "策略", "来源", "管理人", "基金规模(亿元)",
        "日回报", "年初至今", "近一周", "近一月", "近一季",
        "近半年", "近一年", "近两年", "成立以来", "年化回报",
    ]
    rows = []
    for _, r in df[cols].iterrows():
        row = {}
        for c in cols:
            v = r[c]
            if pd.isna(v):
                row[c] = None
            elif isinstance(v, (np.floating, float)):
                row[c] = round(float(v), 4)
            elif isinstance(v, (np.integer, int)):
                row[c] = int(v)
            else:
                row[c] = str(v)
        rows.append(row)
    return rows


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/4] 读取私募基金 …")
    priv = load_private()
    print(f"      私募量化筛出: {len(priv):,} 条")

    print("[2/4] 读取公募（股票型+混合型）…")
    pub = load_public()
    print(f"      公募量化筛出: {len(pub):,} 条")

    print("[3/4] 合并 & 清洗 …")
    df = unify(priv, pub)
    print(f"      合并后: {len(df):,} 条, 策略数: {df['策略'].nunique()}")

    print("[4/4] 聚合 & 导出 JSON …")
    overview = build_overview(df)
    strategy_stats = build_strategy_stats(df)
    heatmap = build_heatmap(df)
    strategy_compare = build_strategy_compare(df)
    top_movers = build_top_movers(df)
    all_funds = build_all_funds(df)

    meta = {
        "buildTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sourceFolder": str(DATA_SRC),
        "snapshotDate": overview["asOf"],
        "privateStrategyWhitelist": sorted(PRIVATE_STRATEGY_WHITELIST),
        "publicKeywords": list(PUBLIC_KEYWORDS),
    }

    payload = {
        "meta.json": meta,
        "overview.json": overview,
        "strategy_stats.json": strategy_stats,
        "strategy_compare.json": strategy_compare,
        "heatmap.json": heatmap,
        "top_movers.json": top_movers,
        "all_funds.json": all_funds,
    }

    for name, obj in payload.items():
        out = OUT_DIR / name
        with out.open("w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        size_kb = out.stat().st_size / 1024
        print(f"      -> {name}  ({size_kb:,.1f} KB)")

    print(f"\n完成。输出目录: {OUT_DIR}")
    print(f"数据快照日期: {overview['asOf']}")
    print(f"总基金数: {overview['totalFunds']:,}  (私募 {overview['privateFunds']:,} / 公募 {overview['publicFunds']:,})")


if __name__ == "__main__":
    main()
