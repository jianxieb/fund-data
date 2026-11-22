# Changheng · Global Investment Research Workbench

**Understand markets. Research assets. Test plans.**

Changheng is built for individual investors in mainland China. It connects macro finance, indices and funds, company research, historical backtests and investing costs, so one question can be followed from "how has this asset behaved" to "what would buying it this way have cost and returned".

[Open Changheng](https://jianxieb.github.io/fund-data/) · [中文说明](README.md) · [How the English interface works](docs/i18n.md)

## Language

The product is Chinese by default. English is opt-in: use the **中文 / EN** switch at the bottom of the sidebar (top right on a phone), or add `?lang=en` to the address. The choice is saved in the browser; `?lang=zh` returns to Chinese.

The English interface translates what the pages render. Names of Chinese funds, fund managers and A-share companies, the long research prose of company and screening reports, and the method documents under `docs/` stay in Chinese. [docs/i18n.md](docs/i18n.md) explains how the translation layer works and how to add or check an entry. The method documents linked below are Chinese.

## Start from an investing question

| Question | Tools |
| --- | --- |
| How do the dollar, inflation and rates feed through to stocks, bonds, gold and property? Where does a current reading sit in its own history? | **Financial transmission, Historical events, Historical percentiles** |
| Which market and instrument to study? Whose tenure drives a fund's return, and are a company's earnings durable? | **Index watch, Fund research, Stock deep dives** |
| What happens if the same asset is bought in another month, held longer or bought in tranches? What about a whole portfolio? | **Holding-period study, Investing strategies, Portfolio simulator** |
| Through which channel to hold it, how do taxes and fees change the result, and how does money go out, come back or get spent? | **Investment channels, Cross-border money flow** |

The research overview gathers these entry points. **Data & methods** lists, for each dataset, its source, observation date, calculation checks and the specific evidence that is missing.

## What it covers

- **Markets and assets**: indices, ETFs, funds and stocks, mainly in mainland China and the United States, including active equity, dividend, bond, broad-market, sector and overseas products.
- **Market history**: the S&P 500 and Nasdaq-100 against their own histories, with price and sourced valuation, volatility and rate series on one timeline.
- **Event studies**: performance after US midterm elections, after market conditions on the signal day, and around moving-average crossings.
- **Companies and funds**: fund manager tenure, NAV return, risk and fees; financials, operations, valuation, dividends and in-depth reports for A-shares and US stocks; filtering, sorting, sources and export.
- **Holding and investing**: complete 1/2/3/5/10-year holding windows for overseas ETFs and US stocks in USD or CNY; lump-sum, tranche and recurring-investment simulations with money-weighted return and path risk shown separately.
- **Return comparison**: indices, ETFs, funds and stocks on common dates, cumulative and annualized.
- **Portfolio simulator**: custom weights over the covered ETFs, stocks and funds with contributions, rebalancing, fees and taxes; XIRR, trend, holding contributions, strategy comparison, start-date check and strategy search; configuration import/export, PDF and CSV.
- **Channels and money**: tax, credit and withholding rules, bank and broker routes, ETF distributions and DRIP, and the cost of moving money between mainland China, Hong Kong and the US.

"Global" is the research viewpoint, not a claim that every country, security or period is covered. Counts, conclusions, observation dates and gaps come from the generated data, not from this file.

## How to read a result

Changheng keeps **sources, dates, bases and gaps** so results can be compared under stated conditions.

- Index levels, ETF adjusted prices and fund NAVs are recorded separately; price and total return, USD and CNY, cumulative and annualized are never mixed.
- A shortfall of history is listed as a gap. Inception-to-date is not substituted for ten years, and another index or interpolation is not used to fill a path.
- Asset performance and money results differ: money waiting in cash before tranche purchases is not an external flow, later contributions are. XIRR, cash-flow-neutral return, max drawdown and loss against principal each say something different.
- Ongoing fees already inside historical NAV are not deducted twice; trading, FX and investor taxes are shown by their own model, with their conditions.
- Percentiles, share of losing windows, screening conclusions and backtests are research. Overlapping windows, sample selection and survivorship can affect interpretation.
- Passing a calculation check is not the same as the source having been verified independently; some evidence may still be missing.

The product offers public research and what-if simulation. It does not connect to a real brokerage account, place trades or generate a personal optimal allocation. Tax content follows the stated status and conditions and is not tax advice.

## Run locally

The front end is a static site that reads the public snapshots in this repository. No npm install, build step or external chart library is needed.

```sh
git clone https://github.com/jianxieb/fund-data.git
cd fund-data
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/>. On Windows replace `python3` with `python`. Keep the whole repository directory; copying `index.html` alone does not work.

## Data refresh and development

The interface, the pure calculations and the Python data pipeline are maintained separately. Refreshing data needs Python 3.9+ and Node.js 18+.

```sh
python3 -m pip install -r requirements.txt
python3 refresh.py --datasets indices      # refresh by dataset, quality check at the end
python3 refresh.py                         # default refresh
```

After a code or data change, update the asset digests and run the checks:

```sh
npm run version-assets
npm run check
npm test
python3 -m unittest discover -s tests -q
python3 data_quality.py --strict
```

| Path | Contents |
| --- | --- |
| `index.html`, `assets/` | navigation, pages, interaction, charts and front-end calculation models |
| `assets/i18n/` | English dictionaries; see [docs/i18n.md](docs/i18n.md) |
| `data/` | display snapshots, sources and verification evidence, daily portfolio history, quality and update status |
| `refresh.py`, `scripts/`, `screens/` | data refresh, calculation, research screening and checks |
| `company-report/` | company data, calculation and report workflow |
| `tests/` | regression checks for the front-end models and the Python data pipeline |
| `docs/` | research methods, maintenance, decisions and review evidence (Chinese) |
