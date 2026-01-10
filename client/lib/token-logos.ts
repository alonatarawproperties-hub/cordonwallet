const TOKEN_LOGOS: Record<string, string> = {
  SOL: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  WETH: "https://assets.coingecko.com/coins/images/2518/small/weth.png",
  POL: "https://coin-images.coingecko.com/coins/images/32440/small/polygon.png",
  MATIC: "https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png",
  BNB: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
  BTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  WBTC: "https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png",
  BTCB: "https://assets.coingecko.com/coins/images/14108/small/Binance-bitcoin.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
  USDT: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  DAI: "https://assets.coingecko.com/coins/images/9956/small/dai-multi-collateral-mcd.png",
  LINK: "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png",
  UNI: "https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png",
  AAVE: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png",
  CRV: "https://assets.coingecko.com/coins/images/12124/small/Curve.png",
  SHIB: "https://assets.coingecko.com/coins/images/11939/small/shiba.png",
  PEPE: "https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg",
  ARB: "https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg",
  OP: "https://assets.coingecko.com/coins/images/25244/small/Optimism.png",
  LDO: "https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png",
  MKR: "https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png",
  SNX: "https://assets.coingecko.com/coins/images/3406/small/SNX.png",
  COMP: "https://assets.coingecko.com/coins/images/10775/small/COMP.png",
  SUSHI: "https://assets.coingecko.com/coins/images/12271/small/512x512_Logo_no_chop.png",
  YFI: "https://assets.coingecko.com/coins/images/11849/small/yearn-finance-yfi.png",
  "1INCH": "https://assets.coingecko.com/coins/images/13469/small/1inch-token.png",
  ENS: "https://assets.coingecko.com/coins/images/19785/small/acatxTm8_400x400.jpg",
  APE: "https://assets.coingecko.com/coins/images/24383/small/apecoin.jpg",
  CAKE: "https://assets.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo_%281%29.png",
  XVS: "https://assets.coingecko.com/coins/images/12677/small/download.png",
  BUSD: "https://assets.coingecko.com/coins/images/9576/small/BUSD.png",
  TUSD: "https://assets.coingecko.com/coins/images/3449/small/tusd.png",
  FRAX: "https://assets.coingecko.com/coins/images/13422/small/FRAX_icon.png",
};

export function getTokenLogoUrl(symbol: string): string | null {
  return TOKEN_LOGOS[symbol.toUpperCase()] || null;
}

export function getChainLogoUrl(chainId: number | string): string | null {
  const chainLogos: Record<string, string> = {
    "1": "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    "137": "https://coin-images.coingecko.com/coins/images/32440/small/polygon.png",
    "56": "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
    "solana": "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  };
  return chainLogos[chainId.toString()] || null;
}
