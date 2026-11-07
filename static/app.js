/* ==========================================================================
   Coto-TradeAI USD/CLP INSTITUTIONAL FX OPTIONS TERMINAL — FRONTEND CONTROLLER
   ========================================================================== */

const BASE_PRICE_DATE = '2026-11-06';

const TENOR_MAP = [
  { label: '1D', days: 1 },
  { label: '1W', days: 7 },
  { label: '2W', days: 14 },
  { label: '3W', days: 21 },
  { label: '1M', days: 32 },
  { label: '2M', days: 61 },
  { label: '3M', days: 96 },
  { label: '4M', days: 124 },
  { label: '5M', days: 154 },
  { label: '6M', days: 184 },
  { label: '9M', days: 275 },
  { label: '1Y', days: 365 },
  { label: '18M', days: 548 },
  { label: '2Y', days: 730 },
];

function addDaysISO(baseIso, days) {
  const dt = new Date(baseIso + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + Math.max(parseInt(days) || 1, 1));
  return dt.toISOString().slice(0, 10);
}

function addSettlementDaysISO(fixIso, settleOffset = 2) {
  const dt = new Date(fixIso + 'T12:00:00Z');
  let added = 0;
  while (added < settleOffset) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return dt.toISOString().slice(0, 10);
}

function diffDaysISO(baseIso, targetIso) {
  const d0 = new Date(baseIso + 'T12:00:00Z');
  const d1 = new Date(targetIso + 'T12:00:00Z');
  return Math.max(Math.round((d1 - d0) / 86400000), 1);
}

function inferTenorLabel(days) {
  let best = TENOR_MAP[0];
  let minDiff = 99999;
  for (const t of TENOR_MAP) {
    const d = Math.abs(t.days - days);
    if (d < minDiff) { minDiff = d; best = t; }
  }
  return minDiff <= 5 ? best.label : `${days}D`;
}

const AppState = {
  pov: 'mesa',
  priceUnit: 'clp_pips',   // 'clp_pips' | 'usd_pips' | 'usd_pct' | 'clp_pct'
  premCurrency: 'CLP',     // 'CLP' | 'USD'
  strategyName: 'Risk Reversal 1 (Collar Exportador)',
  selectedPortfolioFilter: 'ALL',
  volSurface: [],
  portfolioData: { desk_totals: {}, portfolios: [], counterparties: [], deals: [] },
  legs: [
    {
      leg_id: 1,
      instrument: 'Vanilla',
      option_type: 'Call',
      direction: 'Client sells',
      strike: 1023.37,
      notional_usd: 1000000.0,
      days: 96,
      tenor_label: '3M',
      expiry_date: '2027-02-10',
      delivery_date: '2027-02-12',
      model: 'Vanna-Volga',
      custom_vol_pct: null,
      vol_spread_pct: 0.0
    },
    {
      leg_id: 2,
      instrument: 'Vanilla',
      option_type: 'Put',
      direction: 'Client buys',
      strike: 940.00,
      notional_usd: 1000000.0,
      days: 96,
      tenor_label: '3M',
      expiry_date: '2027-02-10',
      delivery_date: '2027-02-12',
      model: 'Vanna-Volga',
      custom_vol_pct: null,
      vol_spread_pct: 1.253
    }
  ],
  lastResult: null,
  lastSmile: null
};

// ==========================================================================
// 1. INITIALIZATION & TAB NAVIGATION
// ==========================================================================

window.addEventListener('DOMContentLoaded', async () => {
  const isPhone = window.innerWidth <= 768 || window.location.search.includes('mobile=1');
  if (isPhone) {
    switchTab('tab-mobile');
  } else {
    switchTab('tab-pricer');
  }
  await Promise.all([
    fetchVolSurface(),
    fetchPortfolioSummary(),
    repriceCurrentStrategy()
  ]);
});

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mob-nav-btn').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  const btn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
  const mobBtn = document.querySelector(`.mob-nav-btn[data-mob-tab="${tabId}"]`);
  if (mobBtn) mobBtn.classList.add('active');

  if (tabId === 'tab-pricer' && AppState.lastResult && AppState.lastSmile) {
    setTimeout(() => {
      drawSmileCanvas(AppState.lastSmile, AppState.lastResult.legs);
      drawPayoffCanvas(AppState.lastResult.payoff_curve, AppState.lastResult.market.spot);
    }, 30);
  }
}

function setPOV(pov) {
  AppState.pov = pov;
  document.getElementById('pov-mesa-btn').classList.toggle('active', pov === 'mesa');
  document.getElementById('pov-cliente-btn').classList.toggle('active', pov === 'cliente');
  document.getElementById('active-pov-label').textContent = pov === 'mesa' ? 'POV MESA LOCAL' : 'POV CLIENTE CORPORATIVO';
  repriceCurrentStrategy();
}

function setPriceUnit(unit) {
  AppState.priceUnit = unit;
  const gSel = document.getElementById('global-price-unit');
  if (gSel && gSel.value !== unit) gSel.value = unit;
  const mSel = document.getElementById('mob-price-unit');
  if (mSel && mSel.value !== unit) mSel.value = unit;
  if (AppState.lastResult) {
    renderOvmlMatrix(AppState.lastResult);
    renderHeroAndGreeks(AppState.lastResult);
    syncMobileUI(AppState.lastResult);
  }
}

function setPremCurrency(curr) {
  AppState.premCurrency = curr;
  if (AppState.lastResult) {
    renderOvmlMatrix(AppState.lastResult);
    renderHeroAndGreeks(AppState.lastResult);
    syncMobileUI(AppState.lastResult);
  }
}

function formatPriceByUnit(obj, unit) {
  const tag = obj.prem_tag || '';
  if (unit === 'usd_pips') {
    return `${(obj.price_usd_pips || 0).toFixed(2)} USD pips ${tag}`;
  }
  if (unit === 'usd_pct') {
    return `${(obj.price_usd_pct || 0).toFixed(4)}% USD ${tag}`;
  }
  if (unit === 'clp_pct') {
    return `${(obj.price_clp_pct || 0).toFixed(4)}% CLP ${tag}`;
  }
  return `${(obj.price_clp_pips || 0).toFixed(3)} CLP pips ${tag}`;
}

function getMarketInputs() {
  return {
    spot: parseFloat(document.getElementById('mkt-spot').value) || 978.55,
    atm_vol_pct: parseFloat(document.getElementById('mkt-atm').value) || 12.738,
    rr25_pct: parseFloat(document.getElementById('mkt-rr25').value) || 1.698,
    bf25_pct: parseFloat(document.getElementById('mkt-bf25').value) || 0.313,
    r_d_pct: parseFloat(document.getElementById('mkt-rd').value) || 3.666,
    r_f_pct: parseFloat(document.getElementById('mkt-rf').value) || 4.063,
    price_date: BASE_PRICE_DATE,
    prem_date: '2026-11-12'
  };
}

// ==========================================================================
// 2. CORE PRICING & Coto-TradeAI MULTI-COLUMN MATRIX RENDERER
// ==========================================================================

async function repriceCurrentStrategy() {
  const mkt = getMarketInputs();
  document.getElementById('hdr-spot-val').textContent = mkt.spot.toFixed(2);
  document.getElementById('mob-spot-lbl').textContent = mkt.spot.toFixed(2);

  const payload = {
    strategy_name: AppState.strategyName,
    pov: AppState.pov,
    market: mkt,
    legs: AppState.legs
  };

  try {
    const res = await fetch('/api/pricing/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    AppState.lastResult = data.result;
    AppState.lastSmile = data.smile;

    renderOvmlMatrix(data.result);
    renderHeroAndGreeks(data.result);
    drawSmileCanvas(data.smile, data.result.legs);
    drawPayoffCanvas(data.result.payoff_curve, mkt.spot);
    syncMobileUI(data.result);
  } catch (err) {
    console.error('Pricing error:', err);
  }
}

function renderOvmlMatrix(res) {
  const tbl = document.getElementById('ovml-grid-table');
  const legs = res.legs || [];
  const sum = res.summary;
  const mkt = res.market;
  const unit = AppState.priceUnit;
  const premCurr = AppState.premCurrency;

  document.getElementById('ovml-ticker-banner').textContent = res.ovml_ticker;
  document.getElementById('matrix-legs-badge').textContent = `${legs.length} ${legs.length === 1 ? 'Pierna Activa' : 'Piernas Activas'}`;

  let html = `<thead><tr>
    <th class="row-label">Parámetro Coto-TradeAI</th>
    <th style="color: var(--ovml-amber-bright); min-width: 165px;">${res.strategy_name}</th>`;

  legs.forEach((l, idx) => {
    html += `<th style="min-width: 165px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>Leg ${idx + 1} (${l.instrument === 'Vanilla' ? l.option_type : l.instrument})</span>
        ${legs.length > 1 ? `<button onclick="removeOptionLeg(${idx})" style="background: rgba(244,63,94,0.2); color: #fb7185; border: none; border-radius: 4px; padding: 1px 6px; cursor: pointer; font-size: 12px;">×</button>` : ''}
      </div>
    </th>`;
  });
  html += `</tr></thead><tbody>`;

  // Row 1: Spot
  html += `<tr>
    <td class="row-label">Spot USD/CLP</td>
    <td class="cell-strategy">Mid &nbsp; ${mkt.spot.toFixed(2)}</td>
    ${legs.map(() => `<td class="cell-leg-tan">${mkt.spot.toFixed(2)}</td>`).join('')}
  </tr>`;

  // Row 2: Style / Instrument
  html += `<tr>
    <td class="row-label">Style / Instrument</td>
    <td class="cell-strategy">European OTC</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <select class="matrix-select" onchange="updateLegField(${i}, 'instrument', this.value)">
        <option value="Vanilla" ${l.instrument === 'Vanilla' ? 'selected' : ''}>European Vanilla</option>
        <option value="FX Forward" ${l.instrument === 'FX Forward' ? 'selected' : ''}>FX Forward</option>
      </select>
    </td>`).join('')}
  </tr>`;

  // Row 3: Direction
  html += `<tr>
    <td class="row-label">Direction</td>
    <td class="cell-strategy">Cash USD</td>
    ${legs.map((l, i) => `<td class="cell-leg-tan">
      <select class="matrix-select" style="color: ${l.direction === 'Client sells' ? '#60a5fa' : '#fbbf24'};" onchange="updateLegField(${i}, 'direction', this.value)">
        <option value="Client sells" ${l.direction === 'Client sells' ? 'selected' : ''}>Client sells</option>
        <option value="Client buys" ${l.direction === 'Client buys' ? 'selected' : ''}>Client buys</option>
      </select>
    </td>`).join('')}
  </tr>`;

  // Row 4: Call / Put
  html += `<tr>
    <td class="row-label">Call / Put</td>
    <td class="cell-strategy">USD</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <select class="matrix-select" onchange="updateLegField(${i}, 'option_type', this.value)" ${l.instrument !== 'Vanilla' ? 'disabled' : ''}>
        <option value="Call" ${l.option_type === 'Call' ? 'selected' : ''}>Call (USD)</option>
        <option value="Put" ${l.option_type === 'Put' ? 'selected' : ''}>Put (USD)</option>
      </select>
    </td>`).join('')}
  </tr>`;

  // Row 5: Plazo (Tenor + Días)
  html += `<tr>
    <td class="row-label">Plazo (Tenor / Días)</td>
    <td class="cell-strategy">${legs[0] ? legs[0].tenor_label : '3M'} (${legs[0] ? legs[0].days : 96}d)</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <div style="display: flex; gap: 4px; align-items: center;">
        <select class="matrix-select" style="max-width: 68px;" onchange="updateLegTenor(${i}, this.value)">
          ${TENOR_MAP.map(t => `<option value="${t.days}" ${l.tenor_label === t.label ? 'selected' : ''}>${t.label}</option>`).join('')}
          ${!TENOR_MAP.some(t => t.label === l.tenor_label) ? `<option value="${l.days}" selected>${l.tenor_label}</option>` : ''}
        </select>
        <input type="number" class="matrix-input" style="max-width: 60px;" value="${l.days}" onchange="updateLegDays(${i}, parseInt(this.value)||30)" title="Días al Fix" />
        <span style="font-size: 12px; color: var(--text-secondary);">días</span>
      </div>
    </td>`).join('')}
  </tr>`;

  // Row 6: Fix (Fixing Date - Dólar Observado)
  html += `<tr>
    <td class="row-label" style="color: var(--ovml-amber-bright);">Fix (Fixing Date)</td>
    <td class="cell-strategy">Stgo 10:30 · ${legs[0] ? legs[0].expiry_date : '2027-02-10'}</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <input type="date" class="matrix-input" style="max-width: 132px; color: #fde68a;" value="${l.expiry_date}" onchange="updateLegFixDate(${i}, this.value)" />
    </td>`).join('')}
  </tr>`;

  // Row 7: Sett (Settlement Date - Liquidación)
  html += `<tr>
    <td class="row-label" style="color: var(--ovml-cyan);">Sett (Settlement)</td>
    <td class="cell-strategy">T+2 · ${legs[0] ? legs[0].delivery_date : '2027-02-12'}</td>
    ${legs.map((l, i) => `<td class="cell-leg-tan">
      <input type="date" class="matrix-input" style="max-width: 132px; color: #38bdf8;" value="${l.delivery_date}" onchange="updateLegField(${i}, 'delivery_date', this.value)" />
    </td>`).join('')}
  </tr>`;

  // Row 8: Strike + % OTMF
  html += `<tr>
    <td class="row-label">Strike (CLP &amp; OTMF)</td>
    <td class="cell-strategy">Fwd ${legs[0] ? legs[0].forward.toFixed(2) : mkt.spot.toFixed(2)}</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <div style="display: flex; gap: 6px; align-items: center;">
        <input type="number" step="0.25" class="matrix-input strike-blue" style="max-width: 86px;" value="${l.strike}" onchange="updateLegField(${i}, 'strike', parseFloat(this.value)||978)" />
        <span style="font-size: 12px; color: #fde68a;">${l.otm_label}</span>
      </div>
    </td>`).join('')}
  </tr>`;

  // Row 9: Notional USD
  html += `<tr>
    <td class="row-label">Notional (USD)</td>
    <td class="cell-strategy">USD ${sum.notional_ref_usd.toLocaleString('en-US')}</td>
    ${legs.map((l, i) => `<td class="cell-leg-tan">
      <input type="number" step="100000" class="matrix-input" style="max-width: 115px;" value="${l.notional_usd}" onchange="updateLegField(${i}, 'notional_usd', parseFloat(this.value)||1000000)" />
    </td>`).join('')}
  </tr>`;

  // Row 10: Valuation Model
  html += `<tr>
    <td class="row-label">Model</td>
    <td class="cell-strategy">${legs[0] ? legs[0].model : 'Vanna-Volga'}</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <select class="matrix-select" onchange="updateLegField(${i}, 'model', this.value)">
        <option value="Vanna-Volga" ${l.model === 'Vanna-Volga' ? 'selected' : ''}>Vanna-Volga</option>
        <option value="Black-Scholes" ${l.model === 'Black-Scholes' ? 'selected' : ''}>Black-Scholes</option>
      </select>
    </td>`).join('')}
  </tr>`;

  // Section Divider: More Market Data
  html += `<tr class="section-divider"><td colspan="${legs.length + 2}">▾ More Market Data (Curvas &amp; Volatilidad Interpolada Coto-TradeAI)</td></tr>`;

  html += `<tr>
    <td class="row-label">Vol BGN / Smile</td>
    <td class="cell-strategy">ATM ${mkt.atm_vol_pct.toFixed(3)}%</td>
    ${legs.map(l => `<td class="cell-leg-amber" style="font-weight: 700; color: var(--ovml-amber-bright);">${l.base_vol_pct.toFixed(3)}% / ${l.eff_vol_pct.toFixed(3)}%</td>`).join('')}
  </tr>`;

  html += `<tr>
    <td class="row-label">Vol Spread (%)</td>
    <td class="cell-strategy">Spread Comercial</td>
    ${legs.map((l, i) => `<td class="cell-leg-amber">
      <input type="number" step="0.05" class="matrix-input" style="max-width: 75px;" value="${l.vol_spread_pct}" onchange="updateLegField(${i}, 'vol_spread_pct', parseFloat(this.value)||0)" />
    </td>`).join('')}
  </tr>`;

  html += `<tr>
    <td class="row-label">Points / Forward</td>
    <td class="cell-strategy">${legs[0] ? legs[0].fwd_points.toFixed(2) : '-0.98'} pts</td>
    ${legs.map(l => `<td class="cell-leg-tan">${l.forward.toFixed(2)} CLP</td>`).join('')}
  </tr>`;

  html += `<tr>
    <td class="row-label">USD SOFR / CLP Depo</td>
    <td class="cell-strategy">${mkt.r_f_pct.toFixed(3)}% / ${mkt.r_d_pct.toFixed(3)}%</td>
    ${legs.map(l => `<td class="cell-leg-tan">${l.usd_depo_pct.toFixed(3)}% / ${l.clp_depo_pct.toFixed(3)}%</td>`).join('')}
  </tr>`;

  // Section Divider: Greeks
  html += `<tr class="section-divider"><td colspan="${legs.length + 2}">▾ Greeks (${AppState.pov === 'mesa' ? 'POV Mesa Local' : 'POV Cliente Corporativo'})</td></tr>`;

  html += `<tr>
    <td class="row-label">Gamma (USD 1%)</td>
    <td class="cell-strategy">${formatSigned(sum.gamma_usd)} USD</td>
    ${legs.map(l => {
      const g = AppState.pov === 'mesa' ? l.mesa_gamma_usd : l.client_gamma_usd;
      return `<td class="cell-leg-amber">${formatSigned(g)}</td>`;
    }).join('')}
  </tr>`;

  html += `<tr>
    <td class="row-label">Vega (CLP 1% Vol)</td>
    <td class="cell-strategy">${formatSigned(sum.vega_clp)} CLP</td>
    ${legs.map(l => {
      const v = AppState.pov === 'mesa' ? l.mesa_vega_clp : l.client_vega_clp;
      return `<td class="cell-leg-amber">${formatSigned(v)}</td>`;
    }).join('')}
  </tr>`;

  // Section Divider: Results
  html += `<tr class="section-divider"><td colspan="${legs.length + 2}">▾ Results (Precio en CLP/USD Pips o % de Prima, Monto Total &amp; Cobertura Spot)</td></tr>`;

  // Price Row with inline unit selector (CLP pips | USD pips | % USD | % CLP)
  html += `<tr>
    <td class="row-label">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
        <span>Price</span>
        <select class="matrix-select" style="max-width: 92px; padding: 1px 4px; color: var(--ovml-amber-bright);" onchange="setPriceUnit(this.value)">
          <option value="clp_pips" ${unit === 'clp_pips' ? 'selected' : ''}>CLP pips</option>
          <option value="usd_pips" ${unit === 'usd_pips' ? 'selected' : ''}>USD pips</option>
          <option value="usd_pct" ${unit === 'usd_pct' ? 'selected' : ''}>% USD</option>
          <option value="clp_pct" ${unit === 'clp_pct' ? 'selected' : ''}>% CLP</option>
        </select>
      </div>
    </td>
    <td class="cell-strategy ${sum.prem_tag === 'R' ? 'val-receive' : 'val-pay'}">${formatPriceByUnit(sum, unit)}</td>
    ${legs.map(l => `<td class="cell-leg-amber ${l.prem_tag === 'R' ? 'val-receive' : 'val-pay'}">${formatPriceByUnit(l, unit)}</td>`).join('')}
  </tr>`;

  // Premium Row with inline currency selector (CLP | USD)
  html += `<tr>
    <td class="row-label">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
        <span>Premium</span>
        <select class="matrix-select" style="max-width: 72px; padding: 1px 4px; color: var(--ovml-cyan);" onchange="setPremCurrency(this.value)">
          <option value="CLP" ${premCurr === 'CLP' ? 'selected' : ''}>CLP</option>
          <option value="USD" ${premCurr === 'USD' ? 'selected' : ''}>USD</option>
        </select>
      </div>
    </td>
    <td class="cell-strategy ${sum.prem_tag === 'R' ? 'val-receive' : 'val-pay'}">
      ${premCurr === 'CLP'
        ? `CLP ${sum.net_prem_abs_clp.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${sum.prem_tag}`
        : `USD ${sum.net_prem_abs_usd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${sum.prem_tag}`}
    </td>
    ${legs.map(l => `<td class="cell-leg-tan ${l.prem_tag === 'R' ? 'val-receive' : 'val-pay'}">
      ${premCurr === 'CLP'
        ? `CLP ${l.premium_clp_abs.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${l.prem_tag}`
        : `USD ${l.premium_usd_abs.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${l.prem_tag}`}
    </td>`).join('')}
  </tr>`;

  html += `<tr>
    <td class="row-label">Delta (Spot %)</td>
    <td class="cell-strategy">${sum.delta_spot_pct.toFixed(4)}%</td>
    ${legs.map(l => {
      const d = AppState.pov === 'mesa' ? l.mesa_delta_pct : l.client_delta_pct;
      return `<td class="cell-leg-amber">${d.toFixed(4)}%</td>`;
    }).join('')}
  </tr>`;

  html += `<tr>
    <td class="row-label">Spot Hedge (USD)</td>
    <td class="cell-strategy" style="color: var(--ovml-emerald);">${formatSigned(sum.hedge_usd)} USD</td>
    ${legs.map(l => {
      const h = AppState.pov === 'mesa' ? l.mesa_hedge_usd : l.client_hedge_usd;
      return `<td class="cell-leg-tan">${formatSigned(h)} USD</td>`;
    }).join('')}
  </tr>`;

  html += `</tbody>`;
  tbl.innerHTML = html;
}

function renderHeroAndGreeks(res) {
  const sum = res.summary;
  const l0 = res.legs[0] || { tenor_label: '3M', days: 96, expiry_date: '2027-02-10', delivery_date: '2027-02-12' };

  document.getElementById('hero-pips-tag').textContent =
    `${sum.price_clp_pips.toFixed(3)} CLP pips | ${sum.price_usd_pips.toFixed(2)} USD pips | ${sum.price_usd_pct.toFixed(3)}% Prima ${sum.prem_tag}`;

  if (AppState.premCurrency === 'USD') {
    document.getElementById('hero-prem-clp').textContent = `USD ${sum.net_prem_abs_usd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${sum.prem_tag}`;
    document.getElementById('hero-prem-usd').textContent = `CLP ${Math.round(sum.net_prem_abs_clp).toLocaleString('en-US')} · ${formatPriceByUnit(sum, AppState.priceUnit)}`;
  } else {
    document.getElementById('hero-prem-clp').textContent = `CLP ${Math.round(sum.net_prem_abs_clp).toLocaleString('en-US')} ${sum.prem_tag}`;
    document.getElementById('hero-prem-usd').textContent = `USD ${sum.net_prem_abs_usd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${sum.prem_tag} · ${formatPriceByUnit(sum, AppState.priceUnit)}`;
  }

  document.getElementById('hero-fix-sett-line').textContent =
    `Plazo: ${l0.tenor_label} (${l0.days}d) · Fix: ${l0.expiry_date} · Sett: ${l0.delivery_date}`;

  document.getElementById('hero-delta-pct').textContent = `${sum.delta_spot_pct.toFixed(4)}%`;
  document.getElementById('hero-hedge-usd').textContent = `${formatSigned(sum.hedge_usd)} USD`;
  document.getElementById('hero-gamma-usd').textContent = `${formatSigned(sum.gamma_usd)} USD`;
  document.getElementById('hero-vega-clp').textContent = `${formatSigned(sum.vega_clp)} CLP`;
  document.getElementById('hero-theta-clp').textContent = `${formatSigned(sum.theta_clp)} CLP`;

  const card = document.getElementById('hedge-banner-card');
  const isSell = sum.mesa_hedge_usd < 0;
  card.classList.toggle('sell', isSell);
  document.getElementById('hedge-banner-title').style.color = isSell ? 'var(--ovml-crimson)' : 'var(--ovml-emerald)';
  document.getElementById('hedge-banner-text').textContent = sum.hedge_instruction;
  document.getElementById('hedge-action-pill').textContent = sum.hedge_action;
}

// ==========================================================================
// 3. CANVAS CHARTS: VANNA-VOLGA SMILE & MULTI-LEG PAYOFF
// ==========================================================================

function drawSmileCanvas(smileObj, pricedLegs) {
  if (!smileObj || !smileObj.curve) return;
  const pillars = smileObj.pillars;
  const curve = smileObj.curve;

  document.getElementById('smile-fwd-label').textContent = `Fwd: ${pillars.fwd.toFixed(2)} CLP`;
  document.getElementById('pil-10p').textContent = `${pillars.vol_10p.toFixed(2)}% (${pillars.k_10p.toFixed(0)})`;
  document.getElementById('pil-25p').textContent = `${pillars.vol_25p.toFixed(2)}% (${pillars.k_25p.toFixed(0)})`;
  document.getElementById('pil-atm').textContent = `${pillars.vol_atm.toFixed(2)}% (${pillars.k_atm.toFixed(0)})`;
  document.getElementById('pil-25c').textContent = `${pillars.vol_25c.toFixed(2)}% (${pillars.k_25c.toFixed(0)})`;
  document.getElementById('pil-10c').textContent = `${pillars.vol_10c.toFixed(2)}% (${pillars.k_10c.toFixed(0)})`;

  const canvas = document.getElementById('smile-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const strikes = curve.map(c => c.strike).concat(pricedLegs.map(l => l.strike));
  const vols = curve.map(c => c.vol_vv).concat(pricedLegs.map(l => l.eff_vol_pct));
  const kMin = Math.min(...strikes) * 0.992;
  const kMax = Math.max(...strikes) * 1.008;
  const vMin = Math.min(...vols) - 0.7;
  const vMax = Math.max(...vols) + 0.8;

  const padL = 46, padR = 20, padT = 18, padB = 28;
  const xOf = k => padL + ((k - kMin) / Math.max(kMax - kMin, 1)) * (W - padL - padR);
  const yOf = v => H - padB - ((v - vMin) / Math.max(vMax - vMin, 0.5)) * (H - padT - padB);

  ctx.strokeStyle = '#192336';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '12px JetBrains Mono, monospace';
  for (let i = 0; i <= 4; i++) {
    const vVal = vMin + (i / 4) * (vMax - vMin);
    const y = yOf(vVal);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(`${vVal.toFixed(1)}%`, 4, y + 4);
  }

  const yAtm = yOf(pillars.vol_atm);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.beginPath(); ctx.moveTo(padL, yAtm); ctx.lineTo(W - padR, yAtm); ctx.stroke();
  ctx.setLineDash([]);

  const grad = ctx.createLinearGradient(padL, 0, W - padR, 0);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(0.5, '#f59e0b');
  grad.addColorStop(1, '#10b981');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  curve.forEach((pt, idx) => {
    const x = xOf(pt.strike), y = yOf(pt.vol_vv);
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const pillarNodes = [
    { k: pillars.k_10p, v: pillars.vol_10p },
    { k: pillars.k_25p, v: pillars.vol_25p },
    { k: pillars.k_atm, v: pillars.vol_atm },
    { k: pillars.k_25c, v: pillars.vol_25c },
    { k: pillars.k_10c, v: pillars.vol_10c },
  ];
  pillarNodes.forEach(p => {
    const x = xOf(p.k), y = yOf(p.v);
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(p.k.toFixed(0), x - 12, H - 8);
  });

  const colors = ['#f59e0b', '#10b981', '#38bdf8', '#f43f5e'];
  pricedLegs.forEach((l, i) => {
    const x = Math.max(padL + 6, Math.min(W - padR - 6, xOf(l.strike)));
    const y = Math.max(padT + 6, Math.min(H - padB - 6, yOf(l.eff_vol_pct)));
    const col = colors[i % colors.length];
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#070a0f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.fillText(`L${i + 1}:${l.strike.toFixed(1)} (${l.eff_vol_pct.toFixed(2)}%)`, Math.min(x - 24, W - 150), Math.max(y - 9, 14));
  });
}

function drawPayoffCanvas(payoffCurve, spotRef) {
  const canvas = document.getElementById('payoff-canvas');
  if (!canvas || !payoffCurve || !payoffCurve.length) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const spots = payoffCurve.map(p => p.spot);
  const pnls = payoffCurve.map(p => p.client_pnl_clp).concat(payoffCurve.map(p => p.mesa_pnl_clp));
  const sMin = Math.min(...spots), sMax = Math.max(...spots);
  const maxAbs = Math.max(Math.abs(Math.min(...pnls)), Math.abs(Math.max(...pnls)), 1000000) * 1.12;

  const padL = 56, padR = 18, padT = 16, padB = 26;
  const xOf = s => padL + ((s - sMin) / Math.max(sMax - sMin, 1)) * (W - padL - padR);
  const yOf = pnl => H - padB - ((pnl + maxAbs) / (2 * maxAbs)) * (H - padT - padB);

  const yZero = yOf(0);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(padL, yZero); ctx.lineTo(W - padR, yZero); ctx.stroke();

  const xSpot = xOf(spotRef);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
  ctx.beginPath(); ctx.moveTo(xSpot, padT); ctx.lineTo(xSpot, H - padB); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  payoffCurve.forEach((pt, idx) => {
    const x = xOf(pt.spot), y = yOf(pt.client_pnl_clp);
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  payoffCurve.forEach((pt, idx) => {
    const x = xOf(pt.spot), y = yOf(pt.mesa_pnl_clp);
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.fillText(`+${(maxAbs / 1e6).toFixed(1)}M`, 4, padT + 8);
  ctx.fillText(`0 CLP`, 10, yZero + 4);
  ctx.fillText(`-${(maxAbs / 1e6).toFixed(1)}M`, 4, H - padB);
  ctx.fillStyle = '#fbbf24';
  ctx.fillText(`Spot ${spotRef.toFixed(1)}`, Math.max(padL, xSpot - 28), H - 7);
}

// ==========================================================================
// 4. MULTI-LEG CONTROLS, PLAZO / FIX / SETT SYNC, PRESETS & SOLVER
// ==========================================================================

function updateLegField(idx, field, val) {
  if (!AppState.legs[idx]) return;
  AppState.legs[idx][field] = val;
  repriceCurrentStrategy();
}

function updateLegTenor(idx, daysVal) {
  const days = parseInt(daysVal) || 96;
  updateLegDays(idx, days);
}

function updateLegDays(idx, days) {
  if (!AppState.legs[idx]) return;
  const d = Math.max(parseInt(days) || 1, 1);
  const fixIso = addDaysISO(BASE_PRICE_DATE, d);
  const settIso = addSettlementDaysISO(fixIso, 2);
  AppState.legs[idx].days = d;
  AppState.legs[idx].tenor_label = inferTenorLabel(d);
  AppState.legs[idx].expiry_date = fixIso;
  AppState.legs[idx].delivery_date = settIso;
  repriceCurrentStrategy();
}

function updateLegFixDate(idx, fixIso) {
  if (!AppState.legs[idx] || !fixIso) return;
  const d = diffDaysISO(BASE_PRICE_DATE, fixIso);
  const settIso = addSettlementDaysISO(fixIso, 2);
  AppState.legs[idx].days = d;
  AppState.legs[idx].tenor_label = inferTenorLabel(d);
  AppState.legs[idx].expiry_date = fixIso;
  AppState.legs[idx].delivery_date = settIso;
  repriceCurrentStrategy();
}

function addOptionLeg() {
  const mkt = getMarketInputs();
  const nextId = AppState.legs.length + 1;
  const refLeg = AppState.legs[0] || { days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12' };
  AppState.legs.push({
    leg_id: nextId,
    instrument: 'Vanilla',
    option_type: nextId % 2 === 1 ? 'Call' : 'Put',
    direction: 'Client buys',
    strike: Math.round(mkt.spot * (nextId % 2 === 1 ? 1.02 : 0.98)),
    notional_usd: 1000000.0,
    days: refLeg.days,
    tenor_label: refLeg.tenor_label,
    expiry_date: refLeg.expiry_date,
    delivery_date: refLeg.delivery_date,
    model: document.getElementById('global-model-select').value,
    custom_vol_pct: null,
    vol_spread_pct: 0.0
  });
  repriceCurrentStrategy();
}

function removeOptionLeg(idx) {
  if (AppState.legs.length <= 1) return;
  AppState.legs.splice(idx, 1);
  AppState.legs.forEach((l, i) => l.leg_id = i + 1);
  repriceCurrentStrategy();
}

function setGlobalModel(modelName) {
  AppState.legs.forEach(l => l.model = modelName);
  repriceCurrentStrategy();
}

async function loadPresetStrategy(presetId) {
  const mkt = getMarketInputs();
  const days = parseInt(document.getElementById('quick-tenor-select').value) || 96;
  const model = document.getElementById('global-model-select').value;

  const res = await fetch('/api/pricing/preset-legs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      notional_usd: 1000000.0,
      days: days,
      tenor_label: inferTenorLabel(days),
      model: model,
      market: mkt
    })
  });
  const data = await res.json();
  AppState.strategyName = data.preset.name;
  document.getElementById('hdr-strategy-desc').textContent = data.preset.description;
  AppState.legs = data.result.legs.map(l => ({
    leg_id: l.leg_id,
    instrument: l.instrument,
    option_type: l.option_type,
    direction: l.direction,
    strike: l.strike,
    notional_usd: l.notional_usd,
    days: l.days,
    tenor_label: l.tenor_label,
    expiry_date: l.expiry_date,
    delivery_date: l.delivery_date,
    model: l.model,
    custom_vol_pct: null,
    vol_spread_pct: l.vol_spread_pct
  }));
  await repriceCurrentStrategy();
}

async function solveZeroCost(legIdx) {
  const mkt = getMarketInputs();
  const targetIdx = Math.min(legIdx, AppState.legs.length - 1);
  const res = await fetch('/api/pricing/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategy_name: AppState.strategyName,
      target_leg_index: targetIdx,
      target_net_prem_clp: 0.0,
      market: mkt,
      legs: AppState.legs
    })
  });
  const data = await res.json();
  if (data.solved_strike) {
    AppState.legs[targetIdx].strike = data.solved_strike;
    await repriceCurrentStrategy();
  }
}

// ==========================================================================
// 5. VOLATILITY SURFACE (1D - 4Y)
// ==========================================================================

async function fetchVolSurface() {
  const res = await fetch('/api/market/surface');
  const data = await res.json();
  AppState.volSurface = data.surface || [];
  const tbody = document.getElementById('vol-surface-tbody');
  if (!tbody) return;

  tbody.innerHTML = AppState.volSurface.map(row => `
    <tr onclick="loadSurfaceRow(${row.days}, '${row.tenor}', ${row.atm_mid}, ${row.rr25_mid}, ${row.bf25_mid}, ${row.clp_depo}, ${row.usd_depo})">
      <td class="tenor-col">${row.tenor}</td>
      <td>${row.days}d</td>
      <td>${row.atm_bid.toFixed(3)} / ${row.atm_ask.toFixed(3)}</td>
      <td style="color: #fff; font-weight: 700;">${row.atm_mid.toFixed(3)}%</td>
      <td>${row.rr25_bid.toFixed(3)} / ${row.rr25_ask.toFixed(3)}</td>
      <td style="color: var(--ovml-cyan);">${row.rr25_mid.toFixed(3)}%</td>
      <td>${row.bf25_bid.toFixed(3)} / ${row.bf25_ask.toFixed(3)}</td>
      <td>${row.bf25_mid.toFixed(3)}%</td>
      <td>${row.rr10_bid.toFixed(3)} / ${row.rr10_ask.toFixed(3)}</td>
      <td>${row.bf10_bid.toFixed(3)} / ${row.bf10_ask.toFixed(3)}</td>
      <td style="color: var(--ovml-emerald);">${row.usd_depo.toFixed(3)}%</td>
      <td style="color: var(--ovml-emerald);">${row.clp_depo.toFixed(3)}%</td>
      <td><button class="ovml-btn amber" style="padding: 2px 8px;">Usar en Coto-TradeAI</button></td>
    </tr>
  `).join('');
}

function loadSurfaceRow(days, tenor, atm, rr25, bf25, rd, rf) {
  document.getElementById('mkt-atm').value = atm.toFixed(3);
  document.getElementById('mkt-rr25').value = rr25.toFixed(3);
  document.getElementById('mkt-bf25').value = bf25.toFixed(3);
  document.getElementById('mkt-rd').value = rd.toFixed(3);
  document.getElementById('mkt-rf').value = rf.toFixed(3);
  const fixIso = addDaysISO(BASE_PRICE_DATE, days);
  const settIso = addSettlementDaysISO(fixIso, 2);
  AppState.legs.forEach(l => {
    l.days = days;
    l.tenor_label = tenor;
    l.expiry_date = fixIso;
    l.delivery_date = settIso;
  });
  switchTab('tab-pricer');
  repriceCurrentStrategy();
}

async function applySurfaceTenor(daysStr) {
  const days = parseInt(daysStr) || 96;
  const spot = parseFloat(document.getElementById('mkt-spot').value) || 978.55;
  const res = await fetch(`/api/market/interpolate?days=${days}&spot=${spot}`);
  const data = await res.json();
  const interp = data.interpolated;
  document.getElementById('mkt-atm').value = interp.atm.toFixed(3);
  document.getElementById('mkt-rr25').value = interp.rr25.toFixed(3);
  document.getElementById('mkt-bf25').value = interp.bf25.toFixed(3);
  document.getElementById('mkt-rd').value = interp.r_d.toFixed(3);
  document.getElementById('mkt-rf').value = interp.r_f.toFixed(3);

  const fixIso = addDaysISO(BASE_PRICE_DATE, days);
  const settIso = addSettlementDaysISO(fixIso, 2);
  const tLabel = inferTenorLabel(days);
  AppState.legs.forEach(l => {
    l.days = days;
    l.tenor_label = tLabel;
    l.expiry_date = fixIso;
    l.delivery_date = settIso;
  });
  const qSel = document.getElementById('quick-tenor-select');
  if (qSel) qSel.value = String(days);
  const mSel = document.getElementById('mob-tenor');
  if (mSel) mSel.value = String(days);
  repriceCurrentStrategy();
}

// ==========================================================================
// 6. PORTFOLIO, COUNTERPARTIES & CREDIT LINES MANAGER
// ==========================================================================

async function fetchPortfolioSummary() {
  const spot = parseFloat(document.getElementById('mkt-spot')?.value) || 978.55;
  const res = await fetch(`/api/portfolio/summary?spot=${spot}`);
  AppState.portfolioData = await res.json();
  renderPortfolioModule();
  populateClientSelectors();
}

function renderPortfolioModule() {
  const d = AppState.portfolioData;
  const tot = d.desk_totals || {};

  document.getElementById('pf-kpi-notional').textContent = `USD ${(tot.total_live_notional_usd || 0).toLocaleString('en-US')}`;
  const unassEl = document.getElementById('pf-kpi-unassigned');
  if (unassEl) {
    unassEl.textContent = `${tot.unassigned_deals_count || 0} Sin Asignar / ${tot.total_deals_count || 0} Total`;
  }
  document.getElementById('pf-kpi-clients').textContent = `${tot.total_counterparties_count || 0} Clientes (${tot.total_portfolios_count || 0} Segmentos)`;
  document.getElementById('pf-kpi-hedge').textContent = `${formatSigned(tot.total_mesa_hedge_usd || 0)} USD`;
  document.getElementById('pf-kpi-prem').textContent = `CLP ${Math.round(tot.total_net_prem_clp || 0).toLocaleString('en-US')}`;

  const grid = document.getElementById('portfolios-grid');
  if (grid) {
    grid.innerHTML = (d.portfolios || []).map(pf => `
      <div class="cartera-card ${AppState.selectedPortfolioFilter === pf.id ? 'selected' : ''}" onclick="filterPortfolio('${pf.id}')">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
          <div>
            <span style="font-size: 12px; color: var(--ovml-amber); font-weight: 700;">${pf.sector}</span>
            <h4 style="font-size: 14px; font-weight: 800; color: #fff; margin-top: 2px;">${pf.name}</h4>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="background: #1e293b; padding: 2px 7px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: var(--ovml-cyan);">
              ${pf.counterparties_count} Clientes
            </span>
            <button onclick="deleteCartera('${pf.id}', event)" title="Eliminar Segmento / Cartera" style="background: rgba(244,63,94,0.18); color: #fda4af; border: 1px solid rgba(244,63,94,0.35); border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 12px;">🗑️</button>
          </div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${Math.min(pf.utilization_pct, 100)}%;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 12px;">
          <span style="color: var(--text-secondary);">Vivo: <strong style="color: #fff;">USD ${(pf.live_notional_usd / 1e6).toFixed(2)}M</strong></span>
          <span style="color: var(--ovml-amber);">${pf.unassigned_deals_count || 0} Sin Asignar</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 12px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #1e293b;">
          <span style="color: var(--text-secondary);">Hedge: ${formatSigned(pf.mesa_hedge_usd)} USD</span>
          <span style="color: var(--ovml-amber-bright);">${pf.deals_count} Tickets</span>
        </div>
      </div>
    `).join('');
  }

  renderPortfolioTables();
}

function filterPortfolio(pfId) {
  AppState.selectedPortfolioFilter = pfId;
  renderPortfolioModule();
}

function renderPortfolioTables() {
  const d = AppState.portfolioData;
  const pfFilter = AppState.selectedPortfolioFilter;
  const q = (document.getElementById('cp-search-input')?.value || '').toLowerCase();
  const allCps = d.counterparties || [];
  const allPfs = d.portfolios || [];

  const cps = allCps.filter(c => {
    const matchPf = pfFilter === 'ALL' || c.portfolio_id === pfFilter;
    const matchQ = !q || c.name.toLowerCase().includes(q) || c.rut.toLowerCase().includes(q);
    return matchPf && matchQ;
  });

  const cpTbody = document.getElementById('counterparties-tbody');
  if (cpTbody) {
    if (cps.length === 0) {
      cpTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 18px; color: var(--text-secondary); font-family: var(--font-sans);">
            🛡️ <strong style="color: var(--ovml-amber-bright);">Modo Test Protegido Activo:</strong> No hay clientes corporativos expuestos en esta vista.
            Las operaciones se mantienen vivas como <strong>⚠️ SIN ASIGNAR</strong> dentro de sus respectivos Segmentos.
            Usa <strong>"+ Nuevo Cliente / Contraparte"</strong> para crear un cliente y asignarle tickets en el Mantenedor superior.
          </td>
        </tr>
      `;
    } else {
      cpTbody.innerHTML = cps.map(c => `
        <tr>
          <td>
            <div style="font-weight: 700; color: #fff; font-family: var(--font-sans);">${c.name}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${c.rut} · ${c.type}</div>
          </td>
          <td style="font-family: var(--font-sans); color: var(--ovml-amber);">${c.portfolio_name}</td>
          <td><span style="padding: 2px 6px; border-radius: 4px; background: #1e293b; font-size: 12px;">${c.flow_profile}</span></td>
          <td>USD ${(c.approved_line_usd / 1e6).toFixed(2)}M</td>
          <td style="font-weight: 700; color: ${c.live_notional_usd > 0 ? 'var(--ovml-amber-bright)' : 'var(--text-secondary)'};">
            USD ${c.live_notional_usd.toLocaleString('en-US')}
          </td>
          <td style="color: ${c.utilization_pct > 75 ? 'var(--ovml-crimson)' : 'var(--ovml-emerald)'}; font-weight: 700;">
            ${c.utilization_pct}%
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="ovml-btn amber" style="padding: 2px 8px;" onclick="quoteForClient('${c.id}')">Cotizar</button>
              <button class="ovml-btn" style="padding: 2px 8px; border-color: rgba(244,63,94,0.4); color: #fda4af;" onclick="deleteClientRow('${c.id}')" title="Eliminar Cliente y dejar sus tickets Sin Asignar">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  }

  const deals = (d.deals || []).filter(dl => pfFilter === 'ALL' || dl.portfolio_id === pfFilter);
  const unassCount = deals.filter(dl => dl.is_unassigned).length;
  document.getElementById('blotter-count-badge').textContent = `${deals.length} Tickets (${unassCount} Sin Asignar)`;

  const dealsTbody = document.getElementById('deals-blotter-tbody');
  if (dealsTbody) {
    dealsTbody.innerHTML = deals.map((dl, idx) => {
      const cpSelectHtml = `
        <select class="matrix-select" style="max-width: 230px; color: ${dl.is_unassigned ? '#fbbf24' : '#34d399'}; font-weight: 700;"
                onchange="assignDealInline('${dl.deal_id}', this.value, null)">
          <option value="UNASSIGNED" ${dl.is_unassigned ? 'selected' : ''}>⚠️ SIN ASIGNAR (Pendiente Cliente)</option>
          ${allCps.map(c => `<option value="${c.id}" ${dl.counterparty_id === c.id ? 'selected' : ''}>🏢 ${c.name} (${c.rut})</option>`).join('')}
        </select>
      `;
      const pfSelectHtml = `
        <select class="matrix-select" style="max-width: 210px; color: var(--ovml-cyan);"
                onchange="assignDealInline('${dl.deal_id}', '${dl.counterparty_id || 'UNASSIGNED'}', this.value)">
          ${allPfs.map(p => `<option value="${p.id}" ${dl.portfolio_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      `;
      return `
        <tr>
          <td style="color: var(--ovml-amber-bright); font-weight: 700;">${dl.deal_id}</td>
          <td>${cpSelectHtml}</td>
          <td>${pfSelectHtml}</td>
          <td>
            <div style="font-family: var(--font-sans); font-weight: 700;">${dl.strategy_name}</div>
            <div style="font-size: 12px; color: var(--ovml-cyan);">${dl.ovml_ticker}</div>
          </td>
          <td>USD ${dl.notional_usd.toLocaleString('en-US')}</td>
          <td class="${dl.valuation.prem_tag === 'R' ? 'val-receive' : 'val-pay'}">
            CLP ${Math.round(dl.valuation.net_prem_abs_clp).toLocaleString('en-US')} ${dl.valuation.prem_tag}
            <div style="font-size: 12px; color: var(--text-secondary);">USD ${Math.round(dl.valuation.net_prem_abs_usd).toLocaleString('en-US')} (${dl.valuation.price_usd_pct.toFixed(2)}%)</div>
          </td>
          <td style="color: var(--ovml-emerald);">${formatSigned(dl.valuation.mesa_hedge_usd)} USD</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="ovml-btn" style="padding: 2px 8px;" onclick="loadBookedDeal(${idx})">Abrir</button>
              <button class="ovml-btn" style="padding: 2px 8px; border-color: rgba(244,63,94,0.4); color: #fda4af;" onclick="deleteDealTicket('${dl.deal_id}')" title="Eliminar Ticket">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
}

function populateClientSelectors() {
  const cps = AppState.portfolioData.counterparties || [];
  const pfs = AppState.portfolioData.portfolios || [];

  const bookSel = document.getElementById('book-cp-select');
  const mobSel = document.getElementById('mob-client-select');
  const unassignedOpt = `<option value="UNASSIGNED">⚠️ SIN ASIGNAR (Guardar solo en Segmento y asignar después)</option>`;
  const cpOptions = unassignedOpt + cps.map(c => `<option value="${c.id}">${c.name} (${c.flow_profile} — Disp: USD ${(c.available_line_usd / 1e6).toFixed(1)}M)</option>`).join('');
  if (bookSel) bookSel.innerHTML = cpOptions;
  if (mobSel) mobSel.innerHTML = cpOptions;

  const pfOptions = pfs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const pfSel = document.getElementById('new-cp-pf');
  if (pfSel) pfSel.innerHTML = pfOptions;
  const bookPfSel = document.getElementById('book-pf-select');
  if (bookPfSel) bookPfSel.innerHTML = pfOptions;
}

async function assignDealInline(dealId, cpId, pfId) {
  await fetch('/api/portfolio/deal/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deal_id: dealId,
      counterparty_id: cpId === 'UNASSIGNED' ? null : cpId,
      portfolio_id: pfId
    })
  });
  await fetchPortfolioSummary();
}

async function deleteDealTicket(dealId) {
  await fetch(`/api/portfolio/deal/${encodeURIComponent(dealId)}`, { method: 'DELETE' });
  await fetchPortfolioSummary();
}

async function deleteClientRow(cpId) {
  await fetch(`/api/portfolio/counterparty/${encodeURIComponent(cpId)}`, { method: 'DELETE' });
  await fetchPortfolioSummary();
}

async function confirmDeleteAllClients() {
  await fetch('/api/portfolio/counterparties-all', { method: 'DELETE' });
  await fetchPortfolioSummary();
}

async function deleteCartera(pfId, evt) {
  if (evt) evt.stopPropagation();
  await fetch(`/api/portfolio/cartera/${encodeURIComponent(pfId)}`, { method: 'DELETE' });
  if (AppState.selectedPortfolioFilter === pfId) {
    AppState.selectedPortfolioFilter = 'ALL';
  }
  await fetchPortfolioSummary();
}

function quoteForClient(cpId) {
  const bookSel = document.getElementById('book-cp-select');
  if (bookSel) bookSel.value = cpId;
  const mobSel = document.getElementById('mob-client-select');
  if (mobSel) mobSel.value = cpId;
  switchTab('tab-pricer');
}

function loadBookedDeal(dealIndex) {
  const pfFilter = AppState.selectedPortfolioFilter;
  const deals = (AppState.portfolioData.deals || []).filter(dl => pfFilter === 'ALL' || dl.portfolio_id === pfFilter);
  const dl = deals[dealIndex];
  if (!dl) return;
  AppState.strategyName = dl.strategy_name;
  AppState.legs = dl.legs.map(l => ({ ...l }));
  switchTab('tab-pricer');
  repriceCurrentStrategy();
}

// ==========================================================================
// 7. MODALS & MOBILE QUOTER SYNC (FIX, SETT, PIPS & % PRIMA)
// ==========================================================================

function openStripModal() { document.getElementById('modal-strips').classList.add('open'); }
function openBookDealModal() {
  document.getElementById('book-strat-name').value = AppState.strategyName;
  document.getElementById('modal-book').classList.add('open');
}
function openNewClientModal() { document.getElementById('modal-new-client').classList.add('open'); }
function openNewCarteraModal() { document.getElementById('modal-new-cartera').classList.add('open'); }
function closeModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
}

async function confirmGenerateStrip() {
  const mkt = getMarketInputs();
  const stripType = document.getElementById('strip-type').value;
  const months = parseInt(document.getElementById('strip-months').value) || 6;
  const notional = parseFloat(document.getElementById('strip-notional').value) || 500000;
  const kPut = parseFloat(document.getElementById('strip-kput').value) || 945;
  const kCall = parseFloat(document.getElementById('strip-kcall').value) || 1020;

  const res = await fetch('/api/pricing/strip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strip_type: stripType,
      months: months,
      monthly_notional_usd: notional,
      strike_put: kPut,
      strike_call: kCall,
      model: document.getElementById('global-model-select').value,
      market: mkt
    })
  });
  const data = await res.json();
  AppState.strategyName = data.result.strategy_name;
  AppState.legs = data.result.legs.map(l => ({
    leg_id: l.leg_id,
    instrument: l.instrument,
    option_type: l.option_type,
    direction: l.direction,
    strike: l.strike,
    notional_usd: l.notional_usd,
    days: l.days,
    tenor_label: l.tenor_label,
    expiry_date: l.expiry_date,
    delivery_date: l.delivery_date,
    model: l.model,
    custom_vol_pct: null,
    vol_spread_pct: l.vol_spread_pct
  }));
  closeModals();
  await repriceCurrentStrategy();
}

async function confirmBookDeal() {
  const cpId = document.getElementById('book-cp-select').value;
  const pfId = document.getElementById('book-pf-select')?.value || null;
  const stratName = document.getElementById('book-strat-name').value || AppState.strategyName;

  await fetch('/api/portfolio/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      counterparty_id: cpId === 'UNASSIGNED' ? null : cpId,
      portfolio_id: pfId,
      strategy_name: stratName,
      mirror_interbank_cp_id: null,
      market: getMarketInputs(),
      legs: AppState.legs
    })
  });
  closeModals();
  await fetchPortfolioSummary();
  switchTab('tab-portfolio');
}

async function confirmCreateClient() {
  const name = document.getElementById('new-cp-name').value;
  const rut = document.getElementById('new-cp-rut').value || '76.000.000-0';
  const pfId = document.getElementById('new-cp-pf').value;
  const profile = document.getElementById('new-cp-profile').value;
  const line = parseFloat(document.getElementById('new-cp-line').value) || 5000000;
  if (!name) return;

  await fetch('/api/portfolio/counterparty', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, rut, portfolio_id: pfId, cp_type: 'Cliente Corporativo', flow_profile: profile, approved_line_usd: line
    })
  });
  closeModals();
  await fetchPortfolioSummary();
}

async function confirmCreateCartera() {
  const name = document.getElementById('new-pf-name').value;
  const sector = document.getElementById('new-pf-sector').value || 'Corporativo';
  const description = document.getElementById('new-pf-desc').value || '';
  if (!name) return;

  await fetch('/api/portfolio/cartera', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sector, manager: 'Mesa FX Corporativa', profile: 'Mixto', description })
  });
  closeModals();
  await fetchPortfolioSummary();
}

// Mobile Quoter Sync
function syncMobileUI(res) {
  if (!res) return;
  const l1 = res.legs[0];
  const l2 = res.legs[1] || res.legs[0];
  document.getElementById('mob-strat-name').textContent = res.strategy_name;
  if (l1) {
    document.getElementById('mob-k1').value = l1.strike;
    document.getElementById('mob-notional').value = l1.notional_usd;
    document.getElementById('mob-days').value = l1.days;
    const fixEl = document.getElementById('mob-fix-date');
    if (fixEl) fixEl.value = l1.expiry_date;
    const settEl = document.getElementById('mob-sett-date');
    if (settEl) settEl.value = l1.delivery_date;
  }
  if (l2) document.getElementById('mob-k2').value = l2.strike;

  const sum = res.summary;
  const u = AppState.priceUnit;
  if (u === 'usd_pips') {
    document.getElementById('mob-prem-clp').textContent = `${sum.price_usd_pips.toFixed(2)} USD pips ${sum.prem_tag}`;
  } else if (u === 'usd_pct') {
    document.getElementById('mob-prem-clp').textContent = `${sum.price_usd_pct.toFixed(4)}% USD (${sum.prem_tag})`;
  } else if (u === 'clp_pct') {
    document.getElementById('mob-prem-clp').textContent = `${sum.price_clp_pct.toFixed(4)}% CLP (${sum.prem_tag})`;
  } else {
    document.getElementById('mob-prem-clp').textContent = `CLP ${Math.round(sum.net_prem_abs_clp).toLocaleString('en-US')} ${sum.prem_tag}`;
  }

  document.getElementById('mob-prem-multi').textContent =
    `USD ${Math.round(sum.net_prem_abs_usd).toLocaleString('en-US')} ${sum.prem_tag} · ${sum.price_clp_pips.toFixed(3)} CLP pips · ${sum.price_usd_pips.toFixed(2)} USD pips · ${sum.price_usd_pct.toFixed(3)}% Prima`;
  document.getElementById('mob-hedge-line').textContent =
    `${sum.hedge_action}: USD ${Math.round(Math.abs(sum.mesa_hedge_usd)).toLocaleString('en-US')}`;

  syncMobileClient();
}

function syncMobileClient() {
  const cpId = document.getElementById('mob-client-select')?.value;
  const cp = cpId && cpId !== 'UNASSIGNED'
    ? (AppState.portfolioData.counterparties || []).find(c => c.id === cpId)
    : null;
  if (cp) {
    document.getElementById('mob-client-sector').textContent = cp.portfolio_name;
    document.getElementById('mob-client-line').textContent = `Línea Disp: USD ${(cp.available_line_usd / 1e6).toFixed(2)}M`;
  } else {
    document.getElementById('mob-client-sector').textContent = '⚠️ Ticket Sin Asignar (Modo Test)';
    document.getElementById('mob-client-line').textContent = 'Asignable después en Mantenedor';
  }
  if (AppState.lastResult) {
    const r = AppState.lastResult;
    const l0 = r.legs[0] || {};
    const legLines = r.legs.map((l, i) =>
      `  • Pierna ${i + 1}: ${l.direction} ${l.option_type} Strike ${l.strike.toFixed(2)} CLP (${l.otm_label}) | Vol ${l.eff_vol_pct.toFixed(2)}% | Fix: ${l.expiry_date} | Sett: ${l.delivery_date} | Prima: CLP ${Math.round(l.premium_clp_abs).toLocaleString('en-US')} (USD ${Math.round(l.premium_usd_abs).toLocaleString('en-US')} / ${l.price_usd_pct.toFixed(3)}%) ${l.prem_tag}`
    ).join('\n');

    document.getElementById('mob-termsheet-preview').textContent =
`====================================================
COTIZACIÓN COTO-TRADEAI DERIVADOS FX — MESA DE DINERO
====================================================
CLIENTE     : ${cp ? cp.name : '⚠️ SIN ASIGNAR (PENDIENTE CLIENTE)'}
SEGMENTO    : ${cp ? cp.portfolio_name : 'Segmento General'}
TICKER      : ${r.ovml_ticker}
ESTRATEGIA  : ${r.strategy_name}
SPOT REF    : ${r.market.spot.toFixed(2)} CLP (Fwd: ${l0.forward?.toFixed(2) || ''} CLP)
NOCIONAL    : USD ${r.summary.notional_ref_usd.toLocaleString('en-US')}
PLAZO       : ${l0.tenor_label || '3M'} (${l0.days || 96} Días)
FIX DATE    : ${l0.expiry_date || ''} (Dólar Observado Stgo 10:30)
SETT DATE   : ${l0.delivery_date || ''} (Liquidación T+2)
----------------------------------------------------
DETALLE DE PIERNAS:
${legLines}
----------------------------------------------------
PRIMA NETA  : CLP ${Math.round(r.summary.net_prem_abs_clp).toLocaleString('en-US')} | USD ${r.summary.net_prem_abs_usd.toLocaleString('en-US', {maximumFractionDigits: 2})} (${r.summary.prem_tag})
PRECIO UNIT : ${r.summary.price_clp_pips.toFixed(3)} CLP pips | ${r.summary.price_usd_pips.toFixed(2)} USD pips | ${r.summary.price_usd_pct.toFixed(4)}% Prima USD
INSTRUCCIÓN : ${r.summary.hedge_instruction}
====================================================`;
  }
}

function updateFromMobile() {
  if (AppState.legs[0]) {
    AppState.legs[0].strike = parseFloat(document.getElementById('mob-k1').value) || 1020;
    AppState.legs[0].notional_usd = parseFloat(document.getElementById('mob-notional').value) || 1000000;
  }
  if (AppState.legs[1]) {
    AppState.legs[1].strike = parseFloat(document.getElementById('mob-k2').value) || 940;
    AppState.legs[1].notional_usd = parseFloat(document.getElementById('mob-notional').value) || 1000000;
  }
  repriceCurrentStrategy();
}

function updateMobileDays(daysVal) {
  const d = Math.max(parseInt(daysVal) || 1, 1);
  const fixIso = addDaysISO(BASE_PRICE_DATE, d);
  const settIso = addSettlementDaysISO(fixIso, 2);
  const tLabel = inferTenorLabel(d);
  AppState.legs.forEach(l => {
    l.days = d;
    l.tenor_label = tLabel;
    l.expiry_date = fixIso;
    l.delivery_date = settIso;
  });
  repriceCurrentStrategy();
}

function updateMobileFixDate(fixIso) {
  if (!fixIso) return;
  const d = diffDaysISO(BASE_PRICE_DATE, fixIso);
  const settIso = addSettlementDaysISO(fixIso, 2);
  const tLabel = inferTenorLabel(d);
  AppState.legs.forEach(l => {
    l.days = d;
    l.tenor_label = tLabel;
    l.expiry_date = fixIso;
    l.delivery_date = settIso;
  });
  repriceCurrentStrategy();
}

function updateMobileSettDate(settIso) {
  if (!settIso) return;
  AppState.legs.forEach(l => {
    l.delivery_date = settIso;
  });
  repriceCurrentStrategy();
}

async function bookFromMobile() {
  const cpId = document.getElementById('mob-client-select').value;
  await fetch('/api/portfolio/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      counterparty_id: cpId === 'UNASSIGNED' ? null : cpId,
      portfolio_id: 'pf_navieras',
      strategy_name: AppState.strategyName,
      mirror_interbank_cp_id: null,
      market: getMarketInputs(),
      legs: AppState.legs
    })
  });
  await fetchPortfolioSummary();
  const toast = document.getElementById('mob-toast');
  toast.style.display = 'block';
  toast.textContent = '✅ Ticket guardado en Mantenedor de Tickets (asignable a cliente en cualquier momento).';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

function copyMobileQuote() {
  const txt = document.getElementById('mob-termsheet-preview').textContent;
  navigator.clipboard?.writeText(txt);
  const toast = document.getElementById('mob-toast');
  toast.style.display = 'block';
  toast.textContent = '📲 Term Sheet Coto-TradeAI copiado al portapapeles.';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

function formatSigned(val) {
  const sign = val >= 0 ? '+' : '-';
  return `${sign}${Math.round(Math.abs(val)).toLocaleString('en-US')}`;
}
