"use strict";

/**
 * EMA Forge - Content Stats Engine
 *
 * Consumes DataParser.state.filteredSessions (already scoped by the sidebar
 * filters) and produces per-question aggregate statistics appropriate to
 * each question type.
 *
 * Design notes worth knowing before you edit this:
 *
 *   1. Denominator discipline. A question that was skipped via skip logic
 *      is *not* the same as "missing." We count a question as "presented"
 *      only if it appears in the session's presentationOrder array. That
 *      means sliders guarded by `if q1 > 70` don't get penalised response
 *      rates when the condition is false.
 *
 *   2. Type-aware value extraction. The CSV long format serializes
 *      everything to strings; the JSON path preserves native types. Both
 *      are handled here — see _coerceValue().
 *
 *   3. Aggregate scoring is ad-hoc. We don't bake scale membership into
 *      the config schema (yet). Instead, the UI lets the researcher pick
 *      a set of questions and compute mean / sum across them. Reverse-
 *      scoring is supported via an optional reverse flag per item.
 *
 *   4. Heart-rate values are objects {bpm, sqi, ibi_series}. We aggregate
 *      bpm and sqi separately; ibi_series is not aggregated here (it's a
 *      signal, not a summary) but we expose n_valid and mean_sqi so the
 *      researcher can eyeball data quality at a glance.
 */

const ContentStats = {

  // -----------------------------------------------------------------
  // Top-level entry point
  // -----------------------------------------------------------------
  compute(sessions, studyConfig) {
    const cfg = studyConfig || {};
    const questions = (cfg.ema?.questions || []).filter(q => q.type !== 'page_break');

    // Build a per-question record collector.
    const byQ = {};
    questions.forEach(q => {
      byQ[q.id] = {
        question: q,
        values: [],          // type-coerced values
        presentedN: 0,       // times the question was shown
        respondedN: 0,       // times a response was recorded
        latencies: [],       // response_latency_ms (when available)
        perDay: {},          // dayNum -> array of values (for sparklines)
        perParticipant: {}   // pid -> array of values (for per-P slicing)
      };
    });

    // Walk each session's ema_response entries and populate.
    sessions.forEach(s => {
      const pid = s.participantId;
      const day = s.day;
      const emaEntries = (s.data || []).filter(e => e && e.type === 'ema_response');

      emaEntries.forEach(entry => {
        // Flatten the presentationOrder matrix into a Set of question IDs
        // actually shown in this session. Fall back to responses keys if
        // the field is absent (older exports).
        const presented = new Set();
        if (entry.presentationOrder) {
          entry.presentationOrder.flat().forEach(qid => presented.add(qid));
        } else if (entry.responses) {
          Object.keys(entry.responses).forEach(qid => presented.add(qid));
        }

        const phaseStartMs = entry.startedAt ? Date.parse(entry.startedAt) : null;

        presented.forEach(qid => {
          if (!byQ[qid]) return; // question not in current config; ignore
          byQ[qid].presentedN++;
        });

        Object.entries(entry.responses || {}).forEach(([qid, rec]) => {
          const bucket = byQ[qid];
          if (!bucket) return;

          const rawVal = (rec && typeof rec === 'object' && 'value' in rec) ? rec.value : rec;
          const coerced = this._coerceValue(rawVal, bucket.question.type);
          if (coerced === undefined) return;

          bucket.respondedN++;
          bucket.values.push(coerced);

          // per-day bucket
          if (!bucket.perDay[day]) bucket.perDay[day] = [];
          bucket.perDay[day].push(coerced);

          // per-participant bucket
          if (!bucket.perParticipant[pid]) bucket.perParticipant[pid] = [];
          bucket.perParticipant[pid].push(coerced);

          // latency
          const respAt = (rec && typeof rec === 'object') ? rec.respondedAt : null;
          if (phaseStartMs && respAt) {
            const lat = Date.parse(respAt) - phaseStartMs;
            if (Number.isFinite(lat) && lat >= 0) bucket.latencies.push(lat);
          }
        });
      });
    });

    // Now summarise each bucket by type.
    const summaries = questions.map(q => this._summarise(byQ[q.id]));

    // Top-level "data at a glance" numbers.
    const overall = this._overallSummary(summaries, sessions);

    return { questions: summaries, overall };
  },

  // -----------------------------------------------------------------
  // Aggregate score (user-defined scale)
  // Given an array of { qid, reverse } picks, compute per-session
  // composite scores and return distribution stats.
  //
  // Reverse-scoring only applies to slider/numeric. We compute
  // reversed = (min + max) - value based on the question's declared
  // min/max. If min/max aren't set, reverse-scoring is skipped.
  // -----------------------------------------------------------------
  computeCompositeScore(sessions, studyConfig, picks, method /* "mean" | "sum" */) {
    const cfg = studyConfig || {};
    const qMap = {};
    (cfg.ema?.questions || []).forEach(q => { qMap[q.id] = q; });

    const sessionScores = []; // { participantId, day, score }

    sessions.forEach(s => {
      (s.data || []).filter(e => e && e.type === 'ema_response').forEach(entry => {
        const values = [];
        for (const pick of picks) {
          const q = qMap[pick.qid];
          const rec = entry.responses?.[pick.qid];
          if (!q || !rec) { values.push(null); continue; }
          const rawVal = (typeof rec === 'object' && 'value' in rec) ? rec.value : rec;
          let num = this._coerceValue(rawVal, q.type);
          if (typeof num !== 'number' || !Number.isFinite(num)) { values.push(null); continue; }
          if (pick.reverse && q.min !== undefined && q.max !== undefined) {
            num = (Number(q.min) + Number(q.max)) - num;
          }
          values.push(num);
        }
        const valid = values.filter(v => v !== null);
        if (valid.length === 0) return;
        // Listwise-complete scoring — require all items to be non-null to
        // produce a score. This matches how most psychometric scales are
        // scored and avoids the silent bias of mean-with-missing.
        if (valid.length !== picks.length) return;
        const score = method === 'sum'
          ? valid.reduce((a, b) => a + b, 0)
          : (valid.reduce((a, b) => a + b, 0) / valid.length);
        sessionScores.push({ participantId: s.participantId, day: s.day, score });
      });
    });

    const scores = sessionScores.map(s => s.score);
    return {
      n: scores.length,
      mean: this._mean(scores),
      sd: this._sd(scores),
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      sessionScores
    };
  },

  // -----------------------------------------------------------------
  // Value coercion — handles both native (JSON) and serialized (CSV)
  // representations.
  // -----------------------------------------------------------------
  _coerceValue(raw, type) {
    if (raw === null || raw === undefined || raw === '') return undefined;

    switch (type) {
      case 'slider':
      case 'numeric': {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
      }
      case 'choice': {
        return String(raw);
      }
      case 'checkbox': {
        if (Array.isArray(raw)) return raw.map(String);
        // CSV serialised as "a;b;c"
        return String(raw).split(';').filter(Boolean);
      }
      case 'text': {
        return String(raw);
      }
      case 'affect_grid': {
        if (raw && typeof raw === 'object' && 'valence' in raw && 'arousal' in raw) {
          return { valence: Number(raw.valence), arousal: Number(raw.arousal) };
        }
        // CSV serialised as "valence;arousal"
        const parts = String(raw).split(';');
        if (parts.length === 2) {
          const v = Number(parts[0]), a = Number(parts[1]);
          if (Number.isFinite(v) && Number.isFinite(a)) return { valence: v, arousal: a };
        }
        return undefined;
      }
      case 'heart_rate': {
        if (raw && typeof raw === 'object' && 'bpm' in raw) {
          return {
            bpm: Number(raw.bpm),
            sqi: raw.sqi !== undefined ? Number(raw.sqi) : null
          };
        }
        // CSV path only stores the numeric cast (bpm), no sqi.
        const n = Number(raw);
        return Number.isFinite(n) ? { bpm: n, sqi: null } : undefined;
      }
      default:
        return raw;
    }
  },

  // -----------------------------------------------------------------
  // Per-question summary dispatcher
  // -----------------------------------------------------------------
  _summarise(bucket) {
    const q = bucket.question;
    const base = {
      id: q.id,
      text: q.text || '(no label)',
      type: q.type,
      presentedN: bucket.presentedN,
      respondedN: bucket.respondedN,
      responseRate: bucket.presentedN ? bucket.respondedN / bucket.presentedN : 0,
      medianLatencyMs: this._median(bucket.latencies),
      values: bucket.values,        // kept for drill-down widgets
      perDay: bucket.perDay,
      perParticipant: bucket.perParticipant
    };

    switch (q.type) {
      case 'slider':
      case 'numeric':
        return { ...base, ...this._summariseNumeric(bucket) };
      case 'choice':
        return { ...base, ...this._summariseCategorical(bucket, [q.options || []].flat()) };
      case 'checkbox':
        return { ...base, ...this._summariseMulti(bucket, [q.options || []].flat()) };
      case 'text':
        return { ...base, ...this._summariseText(bucket) };
      case 'affect_grid':
        return { ...base, ...this._summariseAffect(bucket) };
      case 'heart_rate':
        return { ...base, ...this._summariseHR(bucket) };
      default:
        return base;
    }
  },

  _summariseNumeric(bucket) {
    const vals = bucket.values.filter(v => typeof v === 'number' && Number.isFinite(v));
    return {
      n: vals.length,
      mean: this._mean(vals),
      sd: this._sd(vals),
      median: this._median(vals),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      // per-day mean for sparkline
      perDayMean: Object.fromEntries(
        Object.entries(bucket.perDay).map(([d, arr]) => {
          const nums = arr.filter(v => typeof v === 'number' && Number.isFinite(v));
          return [d, this._mean(nums)];
        })
      )
    };
  },

  _summariseCategorical(bucket, knownOptions) {
    const counts = {};
    bucket.values.forEach(v => {
      const key = String(v);
      counts[key] = (counts[key] || 0) + 1;
    });
    // Make sure declared options appear even if never chosen (zero bars
    // are informative — they show what *wasn't* endorsed).
    (knownOptions || []).forEach(opt => {
      if (!(opt in counts)) counts[opt] = 0;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const dist = Object.entries(counts)
      .map(([k, v]) => ({ option: k, n: v, pct: total ? v / total : 0 }))
      .sort((a, b) => b.n - a.n);
    return { n: total, distribution: dist };
  },

  _summariseMulti(bucket, knownOptions) {
    // Each value is an array. Count option-level endorsements, not
    // response-level. Also return co-selection modal pattern just in
    // case someone wants it down the line.
    const counts = {};
    bucket.values.forEach(arr => {
      (arr || []).forEach(opt => {
        const key = String(opt);
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    (knownOptions || []).forEach(opt => {
      if (!(opt in counts)) counts[opt] = 0;
    });
    const totalResponses = bucket.values.length;
    const dist = Object.entries(counts)
      .map(([k, v]) => ({ option: k, n: v, pct: totalResponses ? v / totalResponses : 0 }))
      .sort((a, b) => b.n - a.n);
    const avgSelected = totalResponses
      ? bucket.values.reduce((a, arr) => a + (arr?.length || 0), 0) / totalResponses
      : 0;
    return { n: totalResponses, distribution: dist, avgSelected };
  },

  _summariseText(bucket) {
    const lens = bucket.values.map(v => String(v).length);
    return {
      n: bucket.values.length,
      avgLength: this._mean(lens),
      medianLength: this._median(lens)
      // We deliberately do NOT return a sample of free-text answers here.
      // Surfacing text snippets in the dashboard is a PII risk — safer to
      // require the researcher to export to CSV and review deliberately.
    };
  },

  _summariseAffect(bucket) {
    const vs = bucket.values.map(v => v.valence).filter(Number.isFinite);
    const as_ = bucket.values.map(v => v.arousal).filter(Number.isFinite);
    return {
      n: bucket.values.length,
      meanValence: this._mean(vs),
      meanArousal: this._mean(as_),
      sdValence: this._sd(vs),
      sdArousal: this._sd(as_),
      points: bucket.values.map(v => ({ x: v.valence, y: v.arousal }))
    };
  },

  _summariseHR(bucket) {
    const bpms = bucket.values.map(v => v.bpm).filter(Number.isFinite);
    const sqis = bucket.values.map(v => v.sqi).filter(v => v !== null && Number.isFinite(v));
    // SQI threshold for "usable" signal. 0.5 is a common cut-off for
    // camera-PPG literature, but it's a soft heuristic — tune in your
    // own analysis. We expose both n and n_usable so you can see the
    // attrition from raw -> analyzable.
    const USABLE_SQI = 0.5;
    const usable = bucket.values.filter(v =>
      Number.isFinite(v.bpm) &&
      (v.sqi === null || v.sqi === undefined || v.sqi >= USABLE_SQI)
    );
    return {
      n: bpms.length,
      nUsable: usable.length,
      meanBpm: this._mean(bpms),
      sdBpm: this._sd(bpms),
      medianBpm: this._median(bpms),
      meanSqi: this._mean(sqis),
      perDayMeanBpm: Object.fromEntries(
        Object.entries(bucket.perDay).map(([d, arr]) => {
          const nums = arr.map(v => v.bpm).filter(Number.isFinite);
          return [d, this._mean(nums)];
        })
      )
    };
  },

  _overallSummary(summaries, sessions) {
    const anyHR = summaries.find(s => s.type === 'heart_rate' && s.n > 0);
    const responseRates = summaries
      .filter(s => s.presentedN > 0)
      .map(s => s.responseRate);
    const medianLatencies = summaries
      .map(s => s.medianLatencyMs)
      .filter(v => v !== null && Number.isFinite(v));

    return {
      nSessions: sessions.length,
      nQuestions: summaries.length,
      nParticipants: new Set(sessions.map(s => s.participantId)).size,
      avgResponseRate: this._mean(responseRates),
      medianItemLatencyMs: this._median(medianLatencies),
      headlineBpm: anyHR ? anyHR.meanBpm : null,
      headlineBpmN: anyHR ? anyHR.n : 0
    };
  },

  // -----------------------------------------------------------------
  // Small stats utilities. Kept intentionally naive — for n in the
  // low thousands (realistic EMA study size) this is fine.
  // -----------------------------------------------------------------
  _mean(arr) {
    if (!arr || arr.length === 0) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  },

  _sd(arr) {
    if (!arr || arr.length < 2) return null;
    const m = this._mean(arr);
    const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(v);
  },

  _median(arr) {
    if (!arr || arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
};
