/* ==========================================================================
   Coto-TradeAI USD/CLP — AUTONOMOUS EDGE QUANT & PORTFOLIO ENGINE
   Allows Coto-TradeAI to run 24/7 on Cloudflare Pages / Static Edge Hosting
   (tradeai.cl) with zero downtime even when the Python FastAPI server is offline.
   Implements:
     - Garman-Kohlhagen (1983) European FX Options + FX Forward
     - Castagna & Mercurio (2007) Vanna-Volga Smile Interpolation
     - Newton-Raphson / Secant Goal-Seek Solver (Zero-Cost Collar)
     - Bloomberg BGN USD/CLP Surface (1D to 4Y)
     - Ticket Maintainer (Sin Asignar / Asignar), Segments & Clients in localStorage
   ========================================================================== */

(function () {
  const STORAGE_KEY = 'coto_tradeai_portfolio_db_v2';

  const VOL_SURFACE_BGN = [
    { tenor: '1D',  days: 1,    atm_bid: 9.670,  atm_ask: 13.050, rr25_bid: -0.230, rr25_ask: 2.135, bf25_bid: -0.670, bf25_ask: 1.020, rr10_bid: -0.215, rr10_ask: 3.840, bf10_bid: -0.780, bf10_ask: 1.925, usd_depo: 4.100, clp_depo: 3.650 },
    { tenor: '1W',  days: 7,    atm_bid: 12.715, atm_ask: 14.515, rr25_bid: 0.720,  rr25_ask: 1.980, bf25_bid: -0.245, bf25_ask: 0.655, rr10_bid: 1.495,  rr10_ask: 3.650, bf10_bid: -0.050, bf10_ask: 1.385, usd_depo: 4.050, clp_depo: 3.645 },
    { tenor: '2W',  days: 14,   atm_bid: 12.355, atm_ask: 14.725, rr25_bid: 0.690,  rr25_ask: 2.350, bf25_bid: -0.365, bf25_ask: 0.820, rr10_bid: 1.460,  rr10_ask: 4.300, bf10_bid: -0.235, bf10_ask: 1.660, usd_depo: 4.010, clp_depo: 3.640 },
    { tenor: '3W',  days: 21,   atm_bid: 12.205, atm_ask: 14.225, rr25_bid: 0.845,  rr25_ask: 2.260, bf25_bid: -0.265, bf25_ask: 0.745, rr10_bid: 1.730,  rr10_ask: 4.155, bf10_bid: -0.065, bf10_ask: 1.550, usd_depo: 3.980, clp_depo: 3.638 },
    { tenor: '1M',  days: 32,   atm_bid: 12.425, atm_ask: 13.935, rr25_bid: 1.075,  rr25_ask: 2.135, bf25_bid: -0.120, bf25_ask: 0.635, rr10_bid: 2.140,  rr10_ask: 3.955, bf10_bid: 0.175,  bf10_ask: 1.385, usd_depo: 3.947, clp_depo: 3.636 },
    { tenor: '2M',  days: 61,   atm_bid: 11.930, atm_ask: 13.430, rr25_bid: 1.140,  rr25_ask: 2.190, bf25_bid: -0.095, bf25_ask: 0.660, rr10_bid: 2.280,  rr10_ask: 4.080, bf10_bid: 0.225,  bf10_ask: 1.425, usd_depo: 4.010, clp_depo: 3.650 },
    { tenor: '3M',  days: 96,   atm_bid: 12.235, atm_ask: 13.240, rr25_bid: 1.345,  rr25_ask: 2.050, bf25_bid: 0.060,  bf25_ask: 0.565, rr10_bid: 2.665,  rr10_ask: 3.875, bf10_bid: 0.500,  bf10_ask: 1.305, usd_depo: 4.063, clp_depo: 3.666 },
    { tenor: '4M',  days: 124,  atm_bid: 12.225, atm_ask: 13.210, rr25_bid: 1.410,  rr25_ask: 2.100, bf25_bid: 0.100,  bf25_ask: 0.595, rr10_bid: 2.805,  rr10_ask: 3.990, bf10_bid: 0.590,  bf10_ask: 1.380, usd_depo: 4.080, clp_depo: 3.680 },
    { tenor: '5M',  days: 154,  atm_bid: 12.207, atm_ask: 13.196, rr25_bid: 1.445,  rr25_ask: 2.140, bf25_bid: 0.124,  bf25_ask: 0.619, rr10_bid: 2.895,  rr10_ask: 4.083, bf10_bid: 0.650,  bf10_ask: 1.441, usd_depo: 4.095, clp_depo: 3.695 },
    { tenor: '6M',  days: 184,  atm_bid: 12.160, atm_ask: 13.160, rr25_bid: 1.455,  rr25_ask: 2.160, bf25_bid: 0.135,  bf25_ask: 0.635, rr10_bid: 2.935,  rr10_ask: 4.135, bf10_bid: 0.680,  bf10_ask: 1.480, usd_depo: 4.110, clp_depo: 3.710 },
    { tenor: '9M',  days: 275,  atm_bid: 12.250, atm_ask: 13.000, rr25_bid: 1.635,  rr25_ask: 2.165, bf25_bid: 0.245,  bf25_ask: 0.625, rr10_bid: 3.300,  rr10_ask: 4.205, bf10_bid: 0.880,  bf10_ask: 1.485, usd_depo: 4.140, clp_depo: 3.750 },
    { tenor: '1Y',  days: 365,  atm_bid: 12.160, atm_ask: 12.915, rr25_bid: 1.650,  rr25_ask: 2.180, bf25_bid: 0.285,  bf25_ask: 0.660, rr10_bid: 3.360,  rr10_ask: 4.270, bf10_bid: 0.975,  bf10_ask: 1.580, usd_depo: 4.165, clp_depo: 3.780 },
    { tenor: '18M', days: 548,  atm_bid: 12.230, atm_ask: 12.975, rr25_bid: 1.665,  rr25_ask: 2.185, bf25_bid: 0.350,  bf25_ask: 0.725, rr10_bid: 3.385,  rr10_ask: 4.280, bf10_bid: 1.110,  bf10_ask: 1.705, usd_depo: 4.190, clp_depo: 3.820 },
    { tenor: '2Y',  days: 730,  atm_bid: 12.250, atm_ask: 13.010, rr25_bid: 1.660,  rr25_ask: 2.195, bf25_bid: 0.385,  bf25_ask: 0.765, rr10_bid: 3.395,  rr10_ask: 4.305, bf10_bid: 1.180,  bf10_ask: 1.785, usd_depo: 4.210, clp_depo: 3.850 },
    { tenor: '3Y',  days: 1095, atm_bid: 11.330, atm_ask: 14.080, rr25_bid: 0.980,  rr25_ask: 2.905, bf25_bid: -0.035, bf25_ask: 1.340, rr10_bid: 2.300,  rr10_ask: 5.600, bf10_bid: 0.570,  bf10_ask: 2.770, usd_depo: 4.240, clp_depo: 3.900 },
    { tenor: '4Y',  days: 1460, atm_bid: 11.385, atm_ask: 14.105, rr25_bid: 0.980,  rr25_ask: 2.880, bf25_bid: 0.020,  bf25_ask: 1.380, rr10_bid: 2.345,  rr10_ask: 5.605, bf10_bid: 0.675,  bf10_ask: 2.850, usd_depo: 4.260, clp_depo: 3.940 },
  ].map(r => ({
    ...r,
    atm_mid:  +(0.5 * (r.atm_bid + r.atm_ask)).toFixed(3),
    rr25_mid: +(0.5 * (r.rr25_bid + r.rr25_ask)).toFixed(3),
    bf25_mid: +(0.5 * (r.bf25_bid + r.bf25_ask)).toFixed(3),
    rr10_mid: +(0.5 * (r.rr10_bid + r.rr10_ask)).toFixed(3),
    bf10_mid: +(0.5 * (r.bf10_bid + r.bf10_ask)).toFixed(3),
  }));

  function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  function normCdf(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2.0);
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return 0.5 * (1.0 + sign * y);
  }

  function interpolateSurfaceByDays(days) {
    const d = Math.max(days, 1);
    const rows = VOL_SURFACE_BGN;
    if (d <= rows[0].days) {
      return { atm: rows[0].atm_mid, rr25: rows[0].rr25_mid, bf25: rows[0].bf25_mid, r_d: rows[0].clp_depo, r_f: rows[0].usd_depo };
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const r0 = rows[i], r1 = rows[i + 1];
      if (d >= r0.days && d <= r1.days) {
        const w = (d - r0.days) / Math.max(r1.days - r0.days, 1);
        return {
          atm:  +(r0.atm_mid  + w * (r1.atm_mid  - r0.atm_mid)).toFixed(3),
          rr25: +(r0.rr25_mid + w * (r1.rr25_mid - r0.rr25_mid)).toFixed(3),
          bf25: +(r0.bf25_mid + w * (r1.bf25_mid - r0.bf25_mid)).toFixed(3),
          r_d:  +(r0.clp_depo + w * (r1.clp_depo - r0.clp_depo)).toFixed(3),
          r_f:  +(r0.usd_depo + w * (r1.usd_depo - r0.usd_depo)).toFixed(3),
        };
      }
    }
    const last = rows[rows.length - 1];
    return { atm: last.atm_mid, rr25: last.rr25_mid, bf25: last.bf25_mid, r_d: last.clp_depo, r_f: last.usd_depo };
  }

  function computeSmilePillars(spot, T, r_d, r_f, atm_vol, rr25, bf25) {
    const fwd = spot * Math.exp((r_d - r_f) * T);
    const sig_atm = Math.max(atm_vol, 0.005);
    const sig_25c = Math.max(sig_atm + bf25 + 0.5 * rr25, 0.005);
    const sig_25p = Math.max(sig_atm + bf25 - 0.5 * rr25, 0.005);
    const rr10 = rr25 * 1.85;
    const bf10 = bf25 * 2.65;
    const sig_10c = Math.max(sig_atm + bf10 + 0.5 * rr10, 0.005);
    const sig_10p = Math.max(sig_atm + bf10 - 0.5 * rr10, 0.005);

    const sqrtT = Math.sqrt(Math.max(T, 1e-6));
    const k_atm = fwd * Math.exp(0.5 * sig_atm * sig_atm * T);
    const alpha25 = -0.67448975; // N^-1(0.25 * e^(r_f*T)) approx
    const alpha10 = -1.28155156;
    const k_25c = fwd * Math.exp(-alpha25 * sig_25c * sqrtT + 0.5 * sig_25c * sig_25c * T);
    const k_25p = fwd * Math.exp( alpha25 * sig_25p * sqrtT + 0.5 * sig_25p * sig_25p * T);
    const k_10c = fwd * Math.exp(-alpha10 * sig_10c * sqrtT + 0.5 * sig_10c * sig_10c * T);
    const k_10p = fwd * Math.exp( alpha10 * sig_10p * sqrtT + 0.5 * sig_10p * sig_10p * T);

    return {
      fwd, k_10p, k_25p, k_atm, k_25c, k_10c,
      vol_10p: sig_10p * 100, vol_25p: sig_25p * 100, vol_atm: sig_atm * 100,
      vol_25c: sig_25c * 100, vol_10c: sig_10c * 100,
      sig_25p, sig_atm, sig_25c
    };
  }

  function vannaVolgaImpliedVol(strike, spot, T, r_d, r_f, atm_vol, rr25, bf25) {
    const p = computeSmilePillars(spot, T, r_d, r_f, atm_vol, rr25, bf25);
    const k1 = Math.log(Math.max(p.k_25p, 1)), k2 = Math.log(Math.max(p.k_atm, 1)), k3 = Math.log(Math.max(p.k_25c, 1));
    const k = Math.log(Math.max(strike, 1));
    const d12 = k1 - k2, d13 = k1 - k3, d23 = k2 - k3;
    if (Math.abs(d12 * d13 * d23) < 1e-10) return p.sig_atm;
    const w1 = ((k - k2) * (k - k3)) / (d12 * d13);
    const w2 = ((k - k1) * (k - k3)) / (-d12 * d23);
    const w3 = ((k - k1) * (k - k2)) / (d13 * d23);
    const sigma = w1 * p.sig_25p + w2 * p.sig_atm + w3 * p.sig_25c;
    return Math.min(Math.max(sigma, 0.02), 0.65);
  }

  function generateSmileCurve(spot, days, r_d_pct, r_f_pct, atm_vol_pct, rr25_pct, bf25_pct) {
    const T = Math.max(days, 1) / 365.0;
    const r_d = r_d_pct / 100, r_f = r_f_pct / 100;
    const atm = atm_vol_pct / 100, rr25 = rr25_pct / 100, bf25 = bf25_pct / 100;
    const pillars = computeSmilePillars(spot, T, r_d, r_f, atm, rr25, bf25);
    const kMin = Math.min(pillars.k_10p * 0.97, spot * 0.90);
    const kMax = Math.max(pillars.k_10c * 1.03, spot * 1.12);
    const curve = [];
    for (let i = 0; i < 41; i++) {
      const k = kMin + (kMax - kMin) * (i / 40);
      const vol_vv = vannaVolgaImpliedVol(k, spot, T, r_d, r_f, atm, rr25, bf25) * 100;
      curve.push({ strike: +k.toFixed(2), vol_vv: +vol_vv.toFixed(3), vol_bs: +atm_vol_pct.toFixed(3) });
    }
    return { pillars, curve };
  }

  function garmanKohlhagenLeg(leg, mkt) {
    const S = mkt.spot;
    const K = leg.strike;
    const T = Math.max(leg.days, 1) / 365.0;
    const r_d = mkt.r_d_pct / 100.0;
    const r_f = mkt.r_f_pct / 100.0;
    const df_d = Math.exp(-r_d * T);
    const df_f = Math.exp(-r_f * T);
    const fwd = S * Math.exp((r_d - r_f) * T);
    const fwd_points = fwd - S;

    let base_vol = mkt.atm_vol_pct / 100.0;
    if (leg.custom_vol_pct != null) {
      base_vol = leg.custom_vol_pct / 100.0;
    } else if (leg.model === 'Vanna-Volga') {
      base_vol = vannaVolgaImpliedVol(K, S, T, r_d, r_f, mkt.atm_vol_pct / 100, mkt.rr25_pct / 100, mkt.bf25_pct / 100);
    }
    const eff_vol = Math.max(base_vol + (leg.vol_spread_pct || 0) / 100.0, 0.005);

    const clientSign = leg.direction === 'Client buys' ? 1.0 : -1.0;
    const mesaSign = -clientSign;

    let unit_price_clp = 0, unit_delta = 0, unit_gamma = 0, unit_vega = 0, unit_theta = 0;
    if (leg.instrument === 'FX Forward') {
      unit_price_clp = df_d * (fwd - K);
      unit_delta = df_f;
    } else {
      const sqrtT = Math.sqrt(T);
      const d1 = (Math.log(S / K) + (r_d - r_f + 0.5 * eff_vol * eff_vol) * T) / (eff_vol * sqrtT);
      const d2 = d1 - eff_vol * sqrtT;
      if (leg.option_type === 'Call') {
        unit_price_clp = S * df_f * normCdf(d1) - K * df_d * normCdf(d2);
        unit_delta = df_f * normCdf(d1);
      } else {
        unit_price_clp = K * df_d * normCdf(-d2) - S * df_f * normCdf(-d1);
        unit_delta = -df_f * normCdf(-d1);
      }
      unit_gamma = (df_f * normPdf(d1)) / (S * eff_vol * sqrtT);
      unit_vega = S * df_f * sqrtT * normPdf(d1) * 0.01;
      unit_theta = -(S * df_f * normPdf(d1) * eff_vol) / (2 * sqrtT) / 365.0;
    }

    const N = leg.notional_usd;
    const total_prem_clp = unit_price_clp * N;
    const total_prem_usd = total_prem_clp / S;
    const price_usd_unit = unit_price_clp / S;
    const prem_tag = leg.direction === 'Client sells' ? 'R' : 'P';
    const ovml_signed_prem_clp = (prem_tag === 'R' ? 1 : -1) * total_prem_clp;
    const ovml_signed_prem_usd = (prem_tag === 'R' ? 1 : -1) * total_prem_usd;

    const otm_pct = ((K - fwd) / fwd) * 100.0;
    const otm_label = `${Math.abs(otm_pct).toFixed(2)}% ${ (leg.option_type === 'Call' && K >= fwd) || (leg.option_type === 'Put' && K <= fwd) ? 'OTMF' : 'ITMF' }`;

    const client_delta_usd = clientSign * unit_delta * N;
    const mesa_delta_usd = mesaSign * unit_delta * N;
    const gamma_usd_1pct = 0.01 * S * unit_gamma * N;

    return {
      leg_id: leg.leg_id,
      instrument: leg.instrument,
      option_type: leg.option_type,
      direction: leg.direction,
      strike: +K.toFixed(2),
      otm_pct: +otm_pct.toFixed(2),
      otm_label,
      notional_usd: +N.toFixed(2),
      days: leg.days,
      tenor_label: leg.tenor_label,
      expiry_date: leg.expiry_date,
      delivery_date: leg.delivery_date,
      fix_date: leg.expiry_date,
      sett_date: leg.delivery_date,
      model: leg.model,
      base_vol_pct: +(base_vol * 100).toFixed(3),
      vol_spread_pct: +(leg.vol_spread_pct || 0).toFixed(3),
      eff_vol_pct: +(eff_vol * 100).toFixed(3),
      forward: +fwd.toFixed(2),
      fwd_points: +fwd_points.toFixed(2),
      usd_depo_pct: +mkt.r_f_pct.toFixed(3),
      clp_depo_pct: +mkt.r_d_pct.toFixed(3),
      price_clp_pips: +unit_price_clp.toFixed(3),
      price_usd_per_usd: +price_usd_unit.toFixed(6),
      price_usd_pips: +(price_usd_unit * 10000).toFixed(2),
      price_usd_pct: +(price_usd_unit * 100).toFixed(4),
      price_clp_pct: +((unit_price_clp / Math.max(K, 1)) * 100).toFixed(4),
      premium_clp_abs: +total_prem_clp.toFixed(2),
      premium_usd_abs: +total_prem_usd.toFixed(2),
      ovml_signed_prem_clp: +ovml_signed_prem_clp.toFixed(2),
      ovml_signed_prem_usd: +ovml_signed_prem_usd.toFixed(2),
      prem_tag,
      client_delta_pct: +(clientSign * unit_delta * 100).toFixed(4),
      client_delta_usd: +client_delta_usd.toFixed(2),
      client_hedge_usd: +(-client_delta_usd).toFixed(2),
      client_gamma_usd: +(clientSign * gamma_usd_1pct).toFixed(2),
      client_vega_clp: +(clientSign * unit_vega * N).toFixed(2),
      client_theta_clp: +(clientSign * unit_theta * N).toFixed(2),
      mesa_delta_pct: +(mesaSign * unit_delta * 100).toFixed(4),
      mesa_delta_usd: +mesa_delta_usd.toFixed(2),
      mesa_hedge_usd: +(-mesa_delta_usd).toFixed(2),
      mesa_gamma_usd: +(mesaSign * gamma_usd_1pct).toFixed(2),
      mesa_vega_clp: +(mesaSign * unit_vega * N).toFixed(2),
      mesa_theta_clp: +(mesaSign * unit_theta * N).toFixed(2),
    };
  }

  function priceStrategyEdge(legs, mkt, strategyName = 'Custom Strategy', pov = 'mesa') {
    const pricedLegs = legs.map(l => garmanKohlhagenLeg(l, mkt));
    const refNotional = pricedLegs.length ? pricedLegs[0].notional_usd : 1000000;
    const net_ovml_prem_clp = pricedLegs.reduce((acc, l) => acc + l.ovml_signed_prem_clp, 0);
    const net_ovml_prem_usd = pricedLegs.reduce((acc, l) => acc + l.ovml_signed_prem_usd, 0);
    const net_prem_tag = net_ovml_prem_clp >= 0 ? 'R' : 'P';
    const net_pips_clp = Math.abs(net_ovml_prem_clp) / Math.max(refNotional, 1);
    const net_unit_usd = Math.abs(net_ovml_prem_usd) / Math.max(refNotional, 1);
    const avgK = pricedLegs.length ? pricedLegs.reduce((a, l) => a + l.strike, 0) / pricedLegs.length : mkt.spot;

    const pKey = pov === 'mesa' ? 'mesa' : 'client';
    const tot_delta_usd = pricedLegs.reduce((a, l) => a + l[`${pKey}_delta_usd`], 0);
    const tot_hedge_usd = pricedLegs.reduce((a, l) => a + l[`${pKey}_hedge_usd`], 0);
    const tot_gamma_usd = pricedLegs.reduce((a, l) => a + l[`${pKey}_gamma_usd`], 0);
    const tot_vega_clp  = pricedLegs.reduce((a, l) => a + l[`${pKey}_vega_clp`], 0);
    const tot_theta_clp = pricedLegs.reduce((a, l) => a + l[`${pKey}_theta_clp`], 0);
    const mesa_hedge_usd = pricedLegs.reduce((a, l) => a + l.mesa_hedge_usd, 0);

    let hedge_action = 'NEUTRAL (SIN ACCIÓN)';
    let hedge_instruction = 'Delta Neutral — No requiere cobertura Spot inmediata.';
    if (Math.abs(mesa_hedge_usd) >= 100) {
      if (mesa_hedge_usd > 0) {
        hedge_action = 'COMPRAR SPOT';
        hedge_instruction = `COMPRAR USD ${Math.abs(mesa_hedge_usd).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} en Spot @ ${mkt.spot.toFixed(2)} CLP para neutralizar Delta.`;
      } else {
        hedge_action = 'VENDER SPOT';
        hedge_instruction = `VENDER USD ${Math.abs(mesa_hedge_usd).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} en Spot @ ${mkt.spot.toFixed(2)} CLP para neutralizar Delta.`;
      }
    }

    const sMin = mkt.spot * 0.88, sMax = mkt.spot * 1.12;
    const payoff_curve = [];
    for (let i = 0; i < 49; i++) {
      const sT = sMin + (sMax - sMin) * (i / 48);
      let clientPay = 0;
      for (const l of pricedLegs) {
        const sign = l.direction === 'Client buys' ? 1 : -1;
        let intr = 0;
        if (l.instrument === 'FX Forward') intr = sT - l.strike;
        else if (l.option_type === 'Call') intr = Math.max(sT - l.strike, 0);
        else intr = Math.max(l.strike - sT, 0);
        clientPay += sign * intr * l.notional_usd;
      }
      const clientPnl = clientPay + net_ovml_prem_clp;
      payoff_curve.push({ spot: +sT.toFixed(2), client_pnl_clp: +clientPnl.toFixed(0), mesa_pnl_clp: +(-clientPnl).toFixed(0) });
    }

    const legTokens = pricedLegs.map(l => `${l.strike.toFixed(2)}${l.instrument === 'Vanilla' ? l.option_type[0] : 'FWD'}`).join(',');
    const expToken = pricedLegs.length ? pricedLegs[0].expiry_date : '3M';
    const ovml_ticker = `Coto-TradeAI USDCLP ${pricedLegs.length > 1 ? 'RR' : 'VAN'} EU ${legTokens} Fix:${expToken} N${(refNotional / 1e6).toFixed(1)}M`;

    return {
      strategy_name: strategyName,
      ovml_ticker,
      pov,
      market: mkt,
      summary: {
        notional_ref_usd: +refNotional.toFixed(2),
        price_clp_pips: +net_pips_clp.toFixed(3),
        price_usd_pips: +(net_unit_usd * 10000).toFixed(2),
        price_usd_pct: +(net_unit_usd * 100).toFixed(4),
        price_clp_pct: +((net_pips_clp / Math.max(avgK, 1)) * 100).toFixed(4),
        net_prem_abs_clp: +Math.abs(net_ovml_prem_clp).toFixed(2),
        net_prem_abs_usd: +Math.abs(net_ovml_prem_usd).toFixed(2),
        net_ovml_prem_clp: +net_ovml_prem_clp.toFixed(2),
        net_ovml_prem_usd: +net_ovml_prem_usd.toFixed(2),
        prem_tag: net_prem_tag,
        delta_spot_pct: +((tot_delta_usd / Math.max(refNotional, 1)) * 100).toFixed(4),
        delta_usd: +tot_delta_usd.toFixed(2),
        hedge_usd: +tot_hedge_usd.toFixed(2),
        gamma_usd: +tot_gamma_usd.toFixed(2),
        vega_clp: +tot_vega_clp.toFixed(2),
        theta_clp: +tot_theta_clp.toFixed(2),
        mesa_hedge_usd: +mesa_hedge_usd.toFixed(2),
        mesa_gamma_usd: +pricedLegs.reduce((a, l) => a + l.mesa_gamma_usd, 0).toFixed(2),
        mesa_vega_clp: +pricedLegs.reduce((a, l) => a + l.mesa_vega_clp, 0).toFixed(2),
        hedge_action,
        hedge_instruction,
      },
      legs: pricedLegs,
      payoff_curve,
    };
  }

  function solveZeroCostEdge(legs, mkt, targetIdx = 0, targetNetPrem = 0) {
    const cloned = legs.map(l => ({ ...l }));
    const idx = Math.min(Math.max(targetIdx, 0), cloned.length - 1);
    const f = k => {
      cloned[idx].strike = Math.max(k, 400);
      return priceStrategyEdge(cloned, mkt).summary.net_ovml_prem_clp - targetNetPrem;
    };
    let k0 = cloned[idx].strike;
    let k1 = k0 * 1.015;
    for (let i = 0; i < 40; i++) {
      const f0 = f(k0), f1 = f(k1);
      if (Math.abs(f1) < 5) break;
      const df = (f1 - f0) / (k1 - k0);
      if (Math.abs(df) < 1e-9) break;
      const kNext = Math.min(Math.max(k1 - f1 / df, mkt.spot * 0.65), mkt.spot * 1.50);
      k0 = k1; k1 = kNext;
    }
    return +k1.toFixed(2);
  }

  function loadLocalDb(mkt) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const initial = {
      portfolios: [
        { id: 'pf_navieras', name: 'Segmento Navieras, Puertos y Logística', sector: 'Puertos & Transporte Marítimo', manager: 'Mesa FX Corporativa', profile: 'Exportador / Generador USD', description: 'Terminales portuarios y navieras con flujos recurrentes en USD.' },
        { id: 'pf_agro', name: 'Segmento Agroexportadoras y Frutícolas', sector: 'Agroindustria & Vinos', manager: 'Mesa FX Agro', profile: 'Exportador Estacional', description: 'Exportadoras frutícolas y viñas que estructuran Zero-Cost Collars.' },
        { id: 'pf_import', name: 'Segmento Importadoras, Retail y Consumo', sector: 'Retail & Importación', manager: 'Mesa FX Importadores', profile: 'Importador / Comprador USD', description: 'Importadoras de bienes durables, vestuario y tecnología.' },
        { id: 'pf_industrial', name: 'Segmento Industrial, Salud y Turismo', sector: 'Corporativo Diversificado', manager: 'Mesa FX Institucional', profile: 'Mixto / Tesorería', description: 'Empresas industriales, farmacéuticas y servicios.' },
        { id: 'pf_interbank', name: 'Segmento Interbancario Offshore (Back-to-Back)', sector: 'Bancos Internacionales', manager: 'Mesa Trading Propio', profile: 'Contraparte Interbancaria (ISDA/CSA)', description: 'Bancos internacionales offshore para calce Back-to-Back.' },
      ],
      counterparties: [],
      deals: [
        {
          deal_id: 'COTO-2026-001', counterparty_id: null, portfolio_id: 'pf_navieras',
          strategy_name: 'Risk Reversal 1 (Collar Exportador)', booked_at: '2026-11-06 10:15',
          legs: [
            { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: 1023.37, notional_usd: 1000000, days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
            { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: 940.00,  notional_usd: 1000000, days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 1.253 },
          ]
        },
        {
          deal_id: 'COTO-2026-002', counterparty_id: null, portfolio_id: 'pf_agro',
          strategy_name: 'Zero-Cost Collar Exportador 6M', booked_at: '2026-11-06 11:02',
          legs: [
            { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: 1032.00, notional_usd: 1500000, days: 184, tenor_label: '6M', expiry_date: '2027-05-09', delivery_date: '2027-05-11', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
            { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: 945.00,  notional_usd: 1500000, days: 184, tenor_label: '6M', expiry_date: '2027-05-09', delivery_date: '2027-05-11', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
          ]
        },
        {
          deal_id: 'COTO-2026-003', counterparty_id: null, portfolio_id: 'pf_import',
          strategy_name: 'Zero-Cost Collar Importador 3M', booked_at: '2026-11-06 12:40',
          legs: [
            { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: 1010.00, notional_usd: 750000, days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
            { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client sells', strike: 952.50,  notional_usd: 750000, days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
          ]
        },
        {
          deal_id: 'COTO-2026-004', counterparty_id: null, portfolio_id: 'pf_industrial',
          strategy_name: 'Call Spread Importador 2M', booked_at: '2026-11-06 14:20',
          legs: [
            { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: 980.00,  notional_usd: 500000, days: 61, tenor_label: '2M', expiry_date: '2027-01-06', delivery_date: '2027-01-08', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
            { leg_id: 2, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: 1015.00, notional_usd: 500000, days: 61, tenor_label: '2M', expiry_date: '2027-01-06', delivery_date: '2027-01-08', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
          ]
        },
        {
          deal_id: 'COTO-2026-005', counterparty_id: null, portfolio_id: 'pf_interbank',
          strategy_name: 'Back-to-Back Mirror RR Offshore', booked_at: '2026-11-06 15:05',
          legs: [
            { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: 1023.37, notional_usd: 1000000, days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
            { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client sells', strike: 940.00,  notional_usd: 1000000, days: 96, tenor_label: '3M', expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: 'Vanna-Volga', custom_vol_pct: null, vol_spread_pct: 0.0 },
          ]
        }
      ]
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  function saveLocalDb(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function computeLocalPortfolioSummary(spot = 978.55) {
    const mkt = { spot, atm_vol_pct: 12.738, rr25_pct: 1.698, bf25_pct: 0.313, r_d_pct: 3.666, r_f_pct: 4.063 };
    const db = loadLocalDb(mkt);
    const cpMap = {};
    db.counterparties.forEach(c => {
      cpMap[c.id] = { ...c, live_notional_usd: 0, deals_count: 0, net_prem_clp: 0, mesa_delta_usd: 0, mesa_vega_clp: 0 };
    });
    const pfMap = {};
    db.portfolios.forEach(p => {
      pfMap[p.id] = { ...p, live_notional_usd: 0, approved_line_usd: 0, deals_count: 0, unassigned_deals_count: 0, counterparties_count: 0, net_prem_clp: 0, mesa_hedge_usd: 0, mesa_gamma_usd: 0, mesa_vega_clp: 0 };
    });

    let unassigned = 0;
    const enrichedDeals = db.deals.map(d => {
      const priced = priceStrategyEdge(d.legs, mkt, d.strategy_name, 'mesa');
      const val = priced.summary;
      const notional = val.notional_ref_usd;
      const rec = { ...d, ovml_ticker: priced.ovml_ticker, notional_usd: notional, valuation: val };
      if (d.counterparty_id && cpMap[d.counterparty_id]) {
        const cp = cpMap[d.counterparty_id];
        cp.live_notional_usd += notional;
        cp.deals_count += 1;
        rec.counterparty_name = cp.name;
        rec.is_unassigned = false;
      } else {
        rec.counterparty_id = null;
        rec.counterparty_name = '⚠️ SIN ASIGNAR (Pendiente Cliente)';
        rec.is_unassigned = true;
        unassigned += 1;
      }
      if (d.portfolio_id && pfMap[d.portfolio_id]) {
        const pf = pfMap[d.portfolio_id];
        pf.live_notional_usd += notional;
        pf.deals_count += 1;
        if (rec.is_unassigned) pf.unassigned_deals_count += 1;
        pf.mesa_hedge_usd += val.mesa_hedge_usd;
        rec.portfolio_name = pf.name;
      } else {
        rec.portfolio_name = 'Sin Segmento';
      }
      return rec;
    });

    const cpsOut = Object.values(cpMap).map(c => {
      const line = Math.max(c.approved_line_usd, 1);
      c.utilization_pct = +((c.live_notional_usd / line) * 100).toFixed(1);
      c.available_line_usd = Math.max(line - c.live_notional_usd, 0);
      if (c.portfolio_id && pfMap[c.portfolio_id]) {
        pfMap[c.portfolio_id].approved_line_usd += c.approved_line_usd;
        pfMap[c.portfolio_id].counterparties_count += 1;
        c.portfolio_name = pfMap[c.portfolio_id].name;
      } else {
        c.portfolio_name = 'Sin Segmento';
      }
      return c;
    });

    const pfsOut = Object.values(pfMap).map(p => {
      p.utilization_pct = p.approved_line_usd > 0 ? +((p.live_notional_usd / p.approved_line_usd) * 100).toFixed(1) : 0;
      return p;
    });

    return {
      desk_totals: {
        total_live_notional_usd: enrichedDeals.reduce((a, d) => a + d.notional_usd, 0),
        total_deals_count: enrichedDeals.length,
        unassigned_deals_count: unassigned,
        total_counterparties_count: cpsOut.length,
        total_portfolios_count: pfsOut.length,
        total_mesa_hedge_usd: enrichedDeals.reduce((a, d) => a + d.valuation.mesa_hedge_usd, 0),
        total_mesa_vega_clp: enrichedDeals.reduce((a, d) => a + d.valuation.mesa_vega_clp, 0),
        total_net_prem_clp: enrichedDeals.reduce((a, d) => a + d.valuation.net_ovml_prem_clp, 0),
      },
      portfolios: pfsOut,
      counterparties: cpsOut,
      deals: enrichedDeals.slice().reverse(),
    };
  }

  // Intercept fetch calls when running on static/Cloudflare Pages or if backend fails
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const urlStr = typeof input === 'string' ? input : input.url;
    try {
      const res = await nativeFetch(input, init);
      if (res && res.ok) return res;
    } catch (e) {
      // Fallback to Autonomous Edge Engine
    }

    const body = init && init.body ? JSON.parse(init.body) : {};
    const method = (init && init.method ? init.method : 'GET').toUpperCase();
    const jsonResp = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (urlStr.includes('/api/market/surface')) {
      return jsonResp({ spot_ref: 978.55, as_of: '2026-11-06', surface: VOL_SURFACE_BGN });
    }
    if (urlStr.includes('/api/market/interpolate')) {
      const u = new URL(urlStr, window.location.origin);
      const days = parseInt(u.searchParams.get('days')) || 96;
      const spot = parseFloat(u.searchParams.get('spot')) || 978.55;
      const interp = interpolateSurfaceByDays(days);
      const smile = generateSmileCurve(spot, days, interp.r_d, interp.r_f, interp.atm, interp.rr25, interp.bf25);
      return jsonResp({ interpolated: interp, smile });
    }
    if (urlStr.includes('/api/pricing/strategy')) {
      const mkt = body.market;
      const result = priceStrategyEdge(body.legs, mkt, body.strategy_name, body.pov);
      const d0 = body.legs[0] ? body.legs[0].days : 96;
      const smile = generateSmileCurve(mkt.spot, d0, mkt.r_d_pct, mkt.r_f_pct, mkt.atm_vol_pct, mkt.rr25_pct, mkt.bf25_pct);
      return jsonResp({ result, smile });
    }
    if (urlStr.includes('/api/pricing/solve')) {
      const mkt = body.market;
      const solved_strike = solveZeroCostEdge(body.legs, mkt, body.target_leg_index, body.target_net_prem_clp || 0);
      const updatedLegs = body.legs.map((l, i) => i === body.target_leg_index ? { ...l, strike: solved_strike } : l);
      const result = priceStrategyEdge(updatedLegs, mkt, body.strategy_name, 'mesa');
      return jsonResp({ solved_strike, result });
    }
    if (urlStr.includes('/api/pricing/preset-legs')) {
      const mkt = body.market;
      const S = mkt.spot || 978.55;
      const d = body.days || 96;
      const t = body.tenor_label || '3M';
      const m = body.model || 'Vanna-Volga';
      const N = body.notional_usd || 1000000;
      const pid = body.preset_id;
      const presets = {
        rr_collar_export: { name: 'Risk Reversal 1 (Collar Exportador)', description: 'Cliente vende Call OTM y compra Put OTM.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +(S * 1.0458).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: +(S * 0.9606).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 1.253 },
        ]},
        zcc_import: { name: 'Zero-Cost Collar (Importador)', description: 'Importador compra Call OTM y vende Put OTM.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: +(S * 1.032).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client sells', strike: +(S * 0.973).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        vanilla_call: { name: 'Vanilla Call (Outright)', description: 'Compra directa de Call USD/CLP.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys', strike: +(S * 1.015).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        vanilla_put: { name: 'Vanilla Put (Outright)', description: 'Compra directa de Put USD/CLP.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Put', direction: 'Client buys', strike: +(S * 0.985).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        straddle: { name: 'Straddle ATM (Cono de Volatilidad)', description: 'Compra simultánea de Call ATM y Put ATM.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys', strike: +S.toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys', strike: +S.toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        strangle: { name: 'Strangle OTM (Cuna de Volatilidad)', description: 'Compra de Call OTM y Put OTM.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys', strike: +(S * 1.03).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys', strike: +(S * 0.97).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        butterfly: { name: 'Butterfly (Mariposa 1x2x1)', description: 'Estructura de 3 piernas Call 1x2x1.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: +(S * 0.975).toFixed(2), notional_usd: N,     days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +S.toFixed(2),           notional_usd: N * 2, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 3, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: +(S * 1.025).toFixed(2), notional_usd: N,     days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        condor: { name: 'Condor (Rango 4 Piernas)', description: 'Estructura de 4 piernas para rango amplio.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: +(S * 0.965).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +(S * 0.990).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 3, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +(S * 1.015).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 4, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: +(S * 1.040).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        participating_fwd: { name: 'Participating Forward (50%)', description: 'Cobertura con 50% de participación.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: +(S * 0.985).toFixed(2), notional_usd: N,       days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +(S * 0.985).toFixed(2), notional_usd: N * 0.5, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        seagull_export: { name: 'Seagull Exportador (3 Piernas)', description: 'Put Spread financiado con venta de Call OTM.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: +(S * 0.975).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client sells', strike: +(S * 0.935).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 3, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +(S * 1.035).toFixed(2), notional_usd: N, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        ratio_straddle: { name: 'Ratio Call Spread (1x2)', description: 'Compra 1x Call ATM y vende 2x Call OTM.', legs: [
          { leg_id: 1, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: +(S * 0.995).toFixed(2), notional_usd: N,     days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: +(S * 1.035).toFixed(2), notional_usd: N * 2, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
        fwd_plus_option: { name: 'Mixta: FX Forward + Opción Call', description: 'Combinación de Forward Sintético más Opción.', legs: [
          { leg_id: 1, instrument: 'FX Forward', option_type: 'Call', direction: 'Client buys', strike: +(S * 0.999).toFixed(2), notional_usd: N * 0.5, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
          { leg_id: 2, instrument: 'Vanilla',    option_type: 'Call', direction: 'Client buys', strike: +(S * 1.020).toFixed(2), notional_usd: N * 0.5, days: d, tenor_label: t, expiry_date: '2027-02-10', delivery_date: '2027-02-12', model: m, vol_spread_pct: 0 },
        ]},
      };
      const p = presets[pid] || presets.rr_collar_export;
      const result = priceStrategyEdge(p.legs, mkt, p.name, 'mesa');
      return jsonResp({ preset: { id: pid, name: p.name, description: p.description }, result });
    }
    if (urlStr.includes('/api/pricing/strip')) {
      const mkt = body.market;
      const months = body.months || 6;
      const N = body.monthly_notional_usd || 500000;
      const kp = body.strike_put || 945;
      const kc = body.strike_call || 1020;
      const m = body.model || 'Vanna-Volga';
      const st = body.strip_type || 'collar_export';
      const legs = [];
      let lid = 1;
      for (let idx = 1; idx <= months; idx++) {
        const d = idx * 30;
        const t = `${idx}M`;
        const fix = new Date(Date.UTC(2026, 10, 6 + d)).toISOString().slice(0, 10);
        const sett = new Date(Date.UTC(2026, 10, 8 + d)).toISOString().slice(0, 10);
        if (st === 'collar_export') {
          legs.push({ leg_id: lid++, instrument: 'Vanilla', option_type: 'Call', direction: 'Client sells', strike: kc, notional_usd: N, days: d, tenor_label: t, expiry_date: fix, delivery_date: sett, model: m, vol_spread_pct: 0 });
          legs.push({ leg_id: lid++, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: kp, notional_usd: N, days: d, tenor_label: t, expiry_date: fix, delivery_date: sett, model: m, vol_spread_pct: 0 });
        } else if (st === 'collar_import') {
          legs.push({ leg_id: lid++, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: kc, notional_usd: N, days: d, tenor_label: t, expiry_date: fix, delivery_date: sett, model: m, vol_spread_pct: 0 });
          legs.push({ leg_id: lid++, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client sells', strike: kp, notional_usd: N, days: d, tenor_label: t, expiry_date: fix, delivery_date: sett, model: m, vol_spread_pct: 0 });
        } else if (st === 'strip_calls') {
          legs.push({ leg_id: lid++, instrument: 'Vanilla', option_type: 'Call', direction: 'Client buys',  strike: kc, notional_usd: N, days: d, tenor_label: t, expiry_date: fix, delivery_date: sett, model: m, vol_spread_pct: 0 });
        } else {
          legs.push({ leg_id: lid++, instrument: 'Vanilla', option_type: 'Put',  direction: 'Client buys',  strike: kp, notional_usd: N, days: d, tenor_label: t, expiry_date: fix, delivery_date: sett, model: m, vol_spread_pct: 0 });
        }
      }
      const result = priceStrategyEdge(legs, mkt, `Strip Mensual (${months}M)`, 'mesa');
      return jsonResp({ result });
    }
    if (urlStr.includes('/api/portfolio/summary')) {
      const u = new URL(urlStr, window.location.origin);
      const spot = parseFloat(u.searchParams.get('spot')) || 978.55;
      return jsonResp(computeLocalPortfolioSummary(spot));
    }
    if (urlStr.includes('/api/portfolio/counterparties-all') && method === 'DELETE') {
      const db = loadLocalDb();
      db.counterparties = [];
      db.deals.forEach(d => { d.counterparty_id = null; });
      saveLocalDb(db);
      return jsonResp({ status: 'ok' });
    }
    if (urlStr.includes('/api/portfolio/counterparty/') && method === 'DELETE') {
      const cpId = decodeURIComponent(urlStr.split('/api/portfolio/counterparty/')[1]);
      const db = loadLocalDb();
      db.counterparties = db.counterparties.filter(c => c.id !== cpId);
      db.deals.forEach(d => { if (d.counterparty_id === cpId) d.counterparty_id = null; });
      saveLocalDb(db);
      return jsonResp({ status: 'ok' });
    }
    if (urlStr.includes('/api/portfolio/counterparty') && method === 'POST') {
      const db = loadLocalDb();
      const newCp = {
        id: `cp_${Date.now().toString(36)}`,
        name: (body.name || '').toUpperCase(),
        rut: body.rut || '76.000.000-0',
        portfolio_id: body.portfolio_id || 'pf_navieras',
        type: body.cp_type || 'Cliente Corporativo',
        flow_profile: body.flow_profile || 'Exportador',
        approved_line_usd: parseFloat(body.approved_line_usd) || 5000000,
        active: true,
      };
      db.counterparties.push(newCp);
      saveLocalDb(db);
      return jsonResp({ counterparty: newCp });
    }
    if (urlStr.includes('/api/portfolio/cartera/') && method === 'DELETE') {
      const pfId = decodeURIComponent(urlStr.split('/api/portfolio/cartera/')[1]);
      const db = loadLocalDb();
      db.portfolios = db.portfolios.filter(p => p.id !== pfId);
      saveLocalDb(db);
      return jsonResp({ status: 'ok' });
    }
    if (urlStr.includes('/api/portfolio/cartera') && method === 'POST') {
      const db = loadLocalDb();
      const newPf = {
        id: `pf_${Date.now().toString(36)}`,
        name: body.name,
        sector: body.sector || 'Corporativo',
        manager: body.manager || 'Mesa FX',
        profile: body.profile || 'Mixto',
        description: body.description || '',
      };
      db.portfolios.push(newPf);
      saveLocalDb(db);
      return jsonResp({ portfolio: newPf });
    }
    if (urlStr.includes('/api/portfolio/book') && method === 'POST') {
      const db = loadLocalDb();
      const dealNum = db.deals.length + 1;
      const newDeal = {
        deal_id: `COTO-2026-00${dealNum}`,
        counterparty_id: body.counterparty_id || null,
        portfolio_id: body.portfolio_id || 'pf_navieras',
        strategy_name: body.strategy_name || 'Estrategia Coto-TradeAI',
        booked_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
        legs: body.legs,
      };
      db.deals.push(newDeal);
      saveLocalDb(db);
      return jsonResp({ deal: newDeal });
    }
    if (urlStr.includes('/api/portfolio/deal/assign') && method === 'POST') {
      const db = loadLocalDb();
      const dl = db.deals.find(d => d.deal_id === body.deal_id);
      if (dl) {
        dl.counterparty_id = body.counterparty_id || null;
        if (body.portfolio_id) dl.portfolio_id = body.portfolio_id;
        saveLocalDb(db);
      }
      return jsonResp({ deal: dl });
    }
    if (urlStr.includes('/api/portfolio/deal/') && method === 'DELETE') {
      const dealId = decodeURIComponent(urlStr.split('/api/portfolio/deal/')[1]);
      const db = loadLocalDb();
      db.deals = db.deals.filter(d => d.deal_id !== dealId);
      saveLocalDb(db);
      return jsonResp({ status: 'ok' });
    }

    return jsonResp({});
  };
})();
