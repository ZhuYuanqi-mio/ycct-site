// =============================================================
// YCCT 前端配置 —— Zion webhook URL
// 数据导入由后台 CSV 上传完成，前端只需要 6 个查询/管理类行为流
// =============================================================
window.YCCT_CONFIG = {
  zion: {
    // 1. 新建股票  入参 stock_json 出参 stock_id
    createStock:  'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/ca58e5e7-3fd6-4116-bc08-06562e760dcd',
    // 2. 查询股票列表  无入参 出参 stocks_data
    listStocks:   'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/8ebbb8f8-4f58-40b5-9603-f55adabc66a1',
    // 3. 删除股票（含其全部 K 线 + 标注）  入参 stock_id 出参 result
    deleteStock:  'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/bd30c9dc-dbb0-4cb4-bd00-8655b09ee709',
    // 4. 查询某只股票的全部日 K（不含 intraday_json，列表轻量）  入参 stock_id 出参 kline_data
    listKline:    'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/b8cba8a6-e3c6-4761-8cec-25200f6d2a89',
    // 5. 查询某天的分时数据（按需展开）  入参 kline_id 出参 intraday_json
    getIntraday:  'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/22b097fc-b571-4161-b03e-e23777c4d4df',
    // 6. 保存某股的标注线 + 显示设置（覆盖式）  入参 stock_id, markers_json, dp_json 出参 result
    saveMarkers:  'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/046c9ebb-17d0-442a-acdc-45113cf06356',
    // 7. 读取某股的标注线 + 显示设置  入参 stock_id 出参 markers_data
    getMarkers:   'https://zion-app.functorz.com/zero/mwLZrNj8qJA/callback/171575ba-a698-4632-95f9-c57f3ad2958b'
  },
  // 请求超时 ms
  timeout: 20000
};
