"use strict";

(function attachLibraryUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EMAForgeLibraryUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLibraryUtils() {
  const ITEM_KINDS = new Set(['protocol', 'question_pack', 'task_preset']);
  const PERSONAL_LIBRARY_KEY = 'ema_forge_personal_library_v1';
  const QUESTION_TYPES = new Set(['slider', 'choice', 'checkbox', 'text', 'numeric', 'affect_grid', 'heart_rate', 'page_break']);
  const TASK_IDS = new Set(['epat', 'hct', 'iat']);
  const TASK_SETTING_KEYS = {
    epat: new Set(['trials', 'trial_duration_sec', 'retry_budget', 'sqi_threshold', 'confidence_ratings', 'two_phase_practice', 'body_map']),
    hct: new Set(['intervals', 'randomize_order', 'include_practice', 'practice_duration_sec', 'instruction_variant', 'instructions', 'show_timer', 'show_progress_ring', 'confidence_ratings', 'body_map', 'body_map_every', 'retry_budget']),
    iat: new Set(['target_a_label', 'target_b_label', 'attr_pos_label', 'attr_neg_label', 'target_a_words', 'target_b_words', 'attr_pos_words', 'attr_neg_words', 'block_trials', 'iti_ms', 'show_practice'])
  };

  function validateCatalog(catalog) {
    const errors = [];
    if (!catalog || catalog.library_schema !== '1.0.0') errors.push('Unsupported library catalog version.');
    if (!Array.isArray(catalog?.items) || catalog.items.length === 0) errors.push('Library catalog has no items.');
    const ids = new Set();
    (catalog?.items || []).forEach((item, index) => {
      if (!item?.id || ids.has(item.id)) errors.push(`Catalog item ${index + 1} needs a unique ID.`);
      ids.add(item?.id);
      if (!ITEM_KINDS.has(item?.kind)) errors.push(`Catalog item ${item?.id || index + 1} has an unsupported kind.`);
      if (!item?.name || !item?.description || !item?.path) errors.push(`Catalog item ${item?.id || index + 1} is missing display metadata.`);
      if (item?.path && (!item.path.startsWith('library/') || item.path.includes('..'))) errors.push(`Catalog item ${item.id} has an unsafe path.`);
    });
    return { valid: errors.length === 0, errors };
  }

  function validateItem(item) {
    const errors = [];
    if (!item || item.library_schema !== '1.0.0') errors.push('Unsupported library item version.');
    if (!ITEM_KINDS.has(item?.kind)) errors.push('Unsupported library item type.');
    if (!item?.id || !item?.name) errors.push('Library item needs an ID and name.');
    if (!item?.source || !item?.license || !item?.validation_status) {
      errors.push('Library item needs source, license, and validation-status metadata.');
    }
    if (item?.measure != null) {
      if (typeof item.measure !== 'object' || Array.isArray(item.measure)) errors.push('Measure metadata must be an object.');
      else {
        const fields = ['instrument', 'timeframe', 'scoring'];
        if (!fields.some(field => String(item.measure[field] || '').trim())) errors.push('Measure metadata must identify an instrument, timeframe, or scoring rule.');
        if (fields.some(field => typeof item.measure[field] !== 'string' || item.measure[field].length > 2000)) errors.push('Measure metadata fields must be text under 2,000 characters.');
      }
    }
    if (item?.kind === 'protocol') {
      const protocol = item.protocol;
      if (!protocol || protocol.schema_version !== '2.0.0') {
        errors.push('Protocol items must contain an EMA Forge 2.0.0 protocol.');
      } else if (!protocol.study || !protocol.onboarding || !protocol.ema || !Array.isArray(protocol.modules) ||
          !Array.isArray(protocol.ema.questions) || !Array.isArray(protocol.ema?.scheduling?.windows)) {
        errors.push('Protocol item is missing required study, onboarding, module, question, or session data.');
      } else if (protocol.modules.some(module => !TASK_IDS.has(module?.id))) {
        errors.push('Protocol items can configure only built-in EMA Forge tasks.');
      }
    }
    if (item?.kind === 'question_pack') validateQuestions(item.questions, errors);
    if (item?.kind === 'task_preset') {
      if (!TASK_IDS.has(item.module_id)) errors.push('Task presets can configure only built-in EMA Forge tasks.');
      if (!item.settings || typeof item.settings !== 'object' || Array.isArray(item.settings)) errors.push('Task preset settings are missing.');
      const allowed = TASK_SETTING_KEYS[item.module_id];
      if (allowed && Object.keys(item.settings || {}).some(key => !allowed.has(key))) {
        errors.push('Task preset contains unsupported settings.');
      }
    }
    return { valid: errors.length === 0, errors };
  }

  function conditionRules(condition) {
    if (!condition) return [];
    return Array.isArray(condition.rules) ? condition.rules : [condition];
  }

  function validateQuestions(questions, errors) {
    if (!Array.isArray(questions) || !questions.some(question => question.type !== 'page_break')) {
      errors.push('Question packs need at least one question.');
      return;
    }
    const ids = new Set();
    questions.forEach((question, index) => {
      if (!question?.id || ids.has(question.id)) errors.push(`Question ${index + 1} needs a unique ID.`);
      if (!QUESTION_TYPES.has(question?.type)) errors.push(`Question ${question?.id || index + 1} has an unsupported type.`);
      conditionRules(question?.condition).forEach(rule => {
        if (!ids.has(rule.question_id)) errors.push(`Question ${question.id} branches on an item that does not appear earlier in the pack.`);
      });
      ids.add(question?.id);
    });
  }

  function rewriteCondition(condition, idMap) {
    if (!condition) return null;
    const copy = JSON.parse(JSON.stringify(condition));
    if (Array.isArray(copy.rules)) copy.rules.forEach(rule => { rule.question_id = idMap.get(rule.question_id) || rule.question_id; });
    else copy.question_id = idMap.get(copy.question_id) || copy.question_id;
    return copy;
  }

  function rewritePiping(text, idMap) {
    return String(text || '').replace(/\{\{([^}]+)\}\}/g, (match, id) => `{{${idMap.get(id) || id}}}`);
  }

  function installQuestionPack(targetState, item, generators) {
    const result = validateItem(item);
    if (!result.valid) throw new Error(result.errors[0]);
    const window = targetState?.ema?.scheduling?.windows?.[0];
    if (!window) throw new Error('Add a session before installing a question pack.');
    if (!Array.isArray(window.phase_sequence)) window.phase_sequence = [];
    const idMap = new Map(item.questions.map(question => [question.id, generators.genQId()]));
    const questions = item.questions.map(question => ({
      ...JSON.parse(JSON.stringify(question)),
      id: idMap.get(question.id),
      text: rewritePiping(question.text, idMap),
      condition: rewriteCondition(question.condition, idMap)
    }));
    targetState.ema.questions.push(...questions);
    window.phase_sequence.push({
      kind: 'ema', id: generators.genSId(), label: item.name,
      question_ids: questions.map(question => question.id)
    });
    return questions.map(question => question.id);
  }

  function installTaskPreset(targetState, item) {
    const result = validateItem(item);
    if (!result.valid) throw new Error(result.errors[0]);
    const module = targetState.modules.find(candidate => candidate.id === item.module_id);
    const window = targetState?.ema?.scheduling?.windows?.[0];
    if (!module || !window) throw new Error('This task is unavailable in the current builder.');
    module.enabled = true;
    module.settings = { ...module.settings, ...JSON.parse(JSON.stringify(item.settings)) };
    if (!Array.isArray(window.phase_sequence)) window.phase_sequence = [];
    if (!window.phase_sequence.some(step => step.kind === 'task' && step.id === item.module_id)) {
      window.phase_sequence.push({ kind: 'task', id: item.module_id, condition: null });
    }
    return item.module_id;
  }

  function protocolForValidation(protocol) {
    const copy = JSON.parse(JSON.stringify(protocol));
    copy.modules = Object.fromEntries((protocol?.modules || [])
      .filter(module => module?.enabled)
      .map(module => [module.id, JSON.parse(JSON.stringify(module.settings || {}))]));
    return copy;
  }

  function slugify(value) {
    return String(value || 'library-item').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'library-item';
  }

  function loadPersonalLibrary(storage) {
    try {
      const parsed = JSON.parse(storage?.getItem(PERSONAL_LIBRARY_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => validateItem(item).valid);
    } catch {
      return [];
    }
  }

  function savePersonalLibrary(items, storage) {
    if (!storage?.setItem) throw new Error('Browser storage is unavailable.');
    const valid = (items || []).filter(item => validateItem(item).valid).slice(-100);
    storage.setItem(PERSONAL_LIBRARY_KEY, JSON.stringify(valid));
    return valid;
  }

  function savePersonalItem(item, storage) {
    const result = validateItem(item);
    if (!result.valid) throw new Error(result.errors[0]);
    const items = loadPersonalLibrary(storage).filter(candidate => candidate.id !== item.id);
    items.push(JSON.parse(JSON.stringify(item)));
    savePersonalLibrary(items, storage);
    return item;
  }

  function deletePersonalItem(id, storage) {
    return savePersonalLibrary(loadPersonalLibrary(storage).filter(item => item.id !== id), storage);
  }

  function createContribution(draft, metadata) {
    if (!draft || draft.schema_version !== '2.0.0') throw new Error('Create or open a current EMA Forge study first.');
    const kind = metadata?.kind;
    if (!ITEM_KINDS.has(kind)) throw new Error('Choose a library item type.');
    if (!String(metadata?.name || '').trim() || !String(metadata?.description || '').trim()) {
      throw new Error('Add a name and description.');
    }
    const item = {
      library_schema: '1.0.0',
      id: `personal-${slugify(metadata.name)}`,
      kind,
      name: String(metadata.name).trim(),
      description: String(metadata.description).trim(),
      source: String(metadata.source || 'Created with EMA Forge; contributor-supplied content.').trim(),
      license: String(metadata.license || 'CC0-1.0').trim(),
      intended_use: String(metadata.intended_use || 'Contributor-supplied research component.').trim(),
      estimated_burden: String(metadata.estimated_burden || 'Not yet estimated.').trim(),
      validation_status: String(metadata.validation_status || 'Contributor supplied; validation not independently reviewed.').trim(),
      device_requirements: String(metadata.device_requirements || 'Any modern phone browser.').trim(),
      features: Array.isArray(metadata.features) ? metadata.features.filter(Boolean).map(String) : []
    };
    if (metadata.instrument || metadata.timeframe || metadata.scoring) {
      item.measure = {
        instrument: String(metadata.instrument || '').trim(),
        timeframe: String(metadata.timeframe || '').trim(),
        scoring: String(metadata.scoring || '').trim()
      };
    }
    if (kind === 'protocol') item.protocol = JSON.parse(JSON.stringify(draft));
    if (kind === 'question_pack') item.questions = JSON.parse(JSON.stringify(draft.ema?.questions || []));
    if (kind === 'task_preset') {
      const module = (draft.modules || []).find(candidate => candidate.id === metadata.module_id);
      if (!module) throw new Error('Choose a built-in task that exists in the current study.');
      item.module_id = module.id;
      item.settings = JSON.parse(JSON.stringify(module.settings || {}));
    }
    const result = validateItem(item);
    if (!result.valid) throw new Error(result.errors[0]);
    return item;
  }

  return { PERSONAL_LIBRARY_KEY, validateCatalog, validateItem, installQuestionPack, installTaskPreset,
    rewritePiping, protocolForValidation, loadPersonalLibrary, savePersonalLibrary, savePersonalItem,
    deletePersonalItem, createContribution, slugify };
});
