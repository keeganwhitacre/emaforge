"use strict";

const branchOperatorLabels = {
  eq: "is", neq: "is not", gt: "is greater than", gte: "is at least",
  lt: "is less than", lte: "is at most", includes: "includes any of",
  includes_all: "includes all of", includes_none: "includes none of"
};

function branchQuestionLabel(question) {
  return questionDisplayText(question?.text || question?.label || question?.id || "Earlier measure");
}

function branchSources(ids) {
  const byId = new Map(state.ema.questions.map(question => [question.id, question]));
  return [...new Set(ids)].map(id => byId.get(id)).filter(question =>
    ['slider', 'numeric', 'heart_rate', 'choice', 'checkbox', 'text', 'body_map'].includes(question?.type));
}

function branchOptions(question) {
  if (question?.type === 'body_map') {
    return [...(question.regions || []).map(region => [region.id, region.label]),
      ...(question.allow_none !== false ? [['none', 'None']] : [])];
  }
  return (question?.options || []).map(option => [option, option]);
}

function branchValueControl(question, value, multiple = false) {
  const options = branchOptions(question);
  if (options.length) {
    const select = document.createElement('select');
    if (!multiple) select.add(new Option('Choose an answer', ''));
    const values = Array.isArray(value) ? value : [value];
    const available = new Set(options.map(([key]) => String(key)));
    for (const key of values) {
      if (key != null && key !== '' && !available.has(String(key))) {
        options.push([key, `${key} (saved value)`]);
      }
    }
    if (multiple) {
      const group = document.createElement('div');
      group.className = 'branch-choice-values';
      group.setAttribute('role', 'group');
      for (const [key, text] of options) {
        if (!String(key).trim()) continue;
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = key;
        checkbox.checked = values.some(item => String(item) === String(key));
        label.append(checkbox, text);
        group.append(label);
      }
      return group;
    }
    for (const [key, label] of options) {
      select.add(new Option(label, key, false, values.some(item => String(item) === String(key))));
    }
    return select;
  }
  const input = document.createElement('input');
  input.type = ['slider', 'numeric', 'heart_rate'].includes(question?.type) && !Array.isArray(value) &&
    (value === '' || value == null || Number.isFinite(Number(value))) ? 'number' : 'text';
  input.value = Array.isArray(value) ? value.join(', ') : value ?? '';
  if (input.type === 'number') {
    input.step = 'any';
    if (question.type === 'slider') input.placeholder = `${question.min ?? 0}–${question.max ?? 100}`;
    if (question.type === 'heart_rate') input.placeholder = 'BPM';
  }
  return input;
}

function readBranchValue(control, previous) {
  if (control.classList.contains('branch-choice-values')) return Array.from(control.querySelectorAll(':checked'), input => input.value);
  if (control.type === 'number' && control.value !== '') return Number(control.value);
  if (Array.isArray(previous) && control.tagName === 'INPUT') return control.value.split(',').map(value => value.trim()).filter(Boolean);
  return control.value;
}

function buildBranchEditor(target, sources, kind) {
  const key = kind === 'page' ? 'page_condition' : 'condition';
  const verb = kind === 'task' ? 'Run' : 'Show';
  const details = document.createElement('details');
  details.className = 'branch-editor';
  const summary = document.createElement('summary');
  const editor = document.createElement('div');
  editor.className = 'branch-editor-body';
  const summaryText = document.createElement('span');
  summary.append(summaryText);
  details.append(summary, editor);
  const byId = new Map(sources.map(source => [source.id, source]));

  function rules() {
    const condition = target[key];
    return condition ? condition.rules || [condition] : [];
  }

  function updateSummary() {
    const items = rules();
    const unavailable = items.some(rule => rule.question_id && !byId.has(rule.question_id));
    const incomplete = !items.length || items.some(rule => !rule.question_id || rule.value == null || rule.value === '' ||
      (Array.isArray(rule.value) && !rule.value.length));
    details.classList.toggle('has-branch', Boolean(target[key]));
    details.classList.toggle('branch-needs-review', unavailable || (Boolean(target[key]) && incomplete));
    if (!target[key]) summaryText.textContent = `Add ${kind === 'task' ? 'run' : 'display'} rule`;
    else if (unavailable) summaryText.textContent = 'Source must come earlier in this session';
    else if (incomplete) summaryText.textContent = 'Finish setting up this rule';
    else summaryText.textContent = `${verb} if ` + items.map(rule => {
      const source = byId.get(rule.question_id);
      const labels = new Map(branchOptions(source).map(([value, label]) => [String(value), label]));
      const value = (Array.isArray(rule.value) ? rule.value : [rule.value]).map(item => labels.get(String(item)) || item).join(', ');
      return `${branchQuestionLabel(source)} ${branchOperatorLabels[rule.operator] || rule.operator} ${value}`;
    }).join(target[key].logical_op === 'OR' ? ' or ' : ' and ');
  }

  function changed(refresh = false) {
    if (refresh) render();
    else updateSummary();
    schedulePreview();
  }

  function render() {
    updateSummary();
    const items = rules();
    editor.replaceChildren();
    if (!items.length && sources.length) {
      const note = document.createElement('p');
      note.className = 'field-hint';
      note.textContent = `${verb} this ${kind} based on an earlier answer.`;
      editor.append(note);
    }
    if (items.length > 1) {
      const mode = document.createElement('select');
      mode.setAttribute('aria-label', 'How conditions are combined');
      mode.add(new Option('All conditions match', 'AND'));
      mode.add(new Option('Any condition matches', 'OR'));
      mode.value = target[key].logical_op || 'AND';
      mode.addEventListener('change', () => { target[key].logical_op = mode.value; changed(); });
      editor.append(mode);
    }
    function field(text, control, className = '') {
      const group = document.createElement('div');
      group.className = `branch-field ${className}`;
      const caption = document.createElement('span');
      caption.textContent = text;
      group.append(caption, control);
      return group;
    }

    function focusRule(index, label) {
      editor.querySelectorAll('.branch-rule')[index]?.querySelector(`[aria-label="Condition ${index + 1} ${label}"]`)?.focus({ preventScroll: true });
    }

    items.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'branch-rule';
      const source = byId.get(rule.question_id);
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Condition ${index + 1} source`);
      select.add(new Option('Earlier measure', ''));
      for (const question of sources) select.add(new Option(branchQuestionLabel(question), question.id));
      if (!source && rule.question_id) {
        const saved = state.ema.questions.find(question => question.id === rule.question_id);
        select.add(new Option(`Unavailable: ${saved ? branchQuestionLabel(saved) : rule.question_id}`, rule.question_id));
      }
      select.value = rule.question_id || '';
      const comparison = document.createElement('select');
      comparison.setAttribute('aria-label', `Condition ${index + 1} comparison`);
      const isMulti = source?.type === 'checkbox' || source?.type === 'body_map';
      const operators = isMulti ? ['includes', 'includes_all', 'includes_none'] :
        ['slider', 'numeric', 'heart_rate'].includes(source?.type) ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] : ['eq', 'neq'];
      if (rule.operator && !operators.includes(rule.operator)) operators.push(rule.operator);
      for (const operator of operators) comparison.add(new Option(branchOperatorLabels[operator] || operator, operator));
      comparison.value = rule.operator || operators[0];
      comparison.disabled = !source;
      const value = branchValueControl(source, rule.value, isMulti && comparison.value.startsWith('includes') || Array.isArray(rule.value));
      value.setAttribute('aria-label', `Condition ${index + 1} answer`);
      if ('disabled' in value) value.disabled = !source;
      select.addEventListener('change', () => {
        rule.question_id = select.value;
        const type = byId.get(select.value)?.type;
        rule.operator = ['checkbox', 'body_map'].includes(type) ? 'includes' : 'eq';
        rule.value = '';
        changed(true);
        focusRule(index, 'comparison');
      });
      comparison.addEventListener('change', () => {
        rule.operator = comparison.value;
        changed(true);
        focusRule(index, 'comparison');
      });
      value.addEventListener('input', () => { rule.value = readBranchValue(value, rule.value); changed(); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'builder-icon-button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove condition ${index + 1}`);
      remove.addEventListener('click', () => {
        const remaining = items.filter((_, i) => i !== index);
        target[key] = remaining.length ? { logical_op: target[key].logical_op || 'AND', rules: remaining } : null;
        changed(true);
        editor.querySelectorAll('.branch-rule')[Math.min(index, remaining.length - 1)]?.querySelector('select')?.focus();
        if (!remaining.length) summary.focus();
      });
      row.append(field('Earlier answer', select, 'branch-source'),
        field('Comparison', comparison), field('Value', value), remove);
      if (comparison.value === 'includes_none') {
        const hint = document.createElement('p');
        hint.className = 'field-hint branch-rule-hint';
        hint.textContent = `Also ${kind === 'task' ? 'skips the task' : 'hides this'} when the earlier question was skipped or left blank.`;
        row.append(hint);
      }
      editor.append(row);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-ghost branch-add';
    add.textContent = 'Add condition';
    add.disabled = !sources.length;
    add.addEventListener('click', () => {
      target[key] = { logical_op: target[key]?.logical_op || 'AND', rules: [...items, { question_id: '', operator: 'eq', value: '' }] };
      changed(true);
      Array.from(editor.querySelectorAll('.branch-rule')).at(-1)?.querySelector('select')?.focus();
    });
    if (sources.length) editor.append(add);
    if (!sources.length) {
      const help = document.createElement('p');
      help.className = 'field-hint';
      help.textContent = 'Add an answerable measure earlier in this session to create a rule.';
      editor.append(help);
    }
  }

  render();
  return details;
}

function openBranchTester(session, trigger) {
  const dialog = document.getElementById('branch-tester');
  const fields = dialog.querySelector('.branch-test-inputs');
  const results = dialog.querySelector('.branch-test-results');
  const reset = dialog.querySelector('.branch-test-reset');
  if (dialog.open) {
    dialog.querySelector('[autofocus]').focus({ preventScroll: true });
    return;
  }
  dialog.querySelector('.branch-test-session').textContent = session.label || 'Untitled session';
  const answers = Object.create(null);
  const questions = state.ema.questions;
  const questionById = id => questions.find(question => question.id === id);
  const evaluate = () => EMAForgeRuntimeUtils.traceBranches(questions, session.phase_sequence, answers);

  function update() {
    results.replaceChildren();
    for (const item of evaluate().trace) {
      const { waiting } = item;
      const row = document.createElement('div');
      row.className = 'branch-test-result';
      const title = document.createElement('strong');
      title.textContent = item.kind === 'task'
        ? state.modules.find(module => module.id === item.id)?.label || item.id
        : branchQuestionLabel(questionById(item.id));
      const status = document.createElement('span');
      status.className = `branch-status ${item.shown ? 'shown' : waiting ? 'waiting' : ''}`;
      status.textContent = item.shown ? 'Shown' : waiting ? 'Waiting' : 'Skipped';
      if (waiting) row.classList.add('is-waiting');
      if (item.pageSkipped) row.classList.add('branch-test-page-child');
      if (item.kind === 'page') {
        const type = document.createElement('span');
        type.className = 'branch-result-kind';
        type.textContent = 'Page';
        title.prepend(type);
      }
      row.append(title, status);
      if (!item.shown) {
        const reason = document.createElement('small');
        const sourceNames = ids => ids.map(id => `“${branchQuestionLabel(questionById(id))}”`).join(', ');
        const failedAnswers = item.failed?.filter(({ value }) => value != null && value !== '').map(({ id, value }) => {
          const question = questionById(id);
          const labels = new Map(branchOptions(question));
          const displayed = (Array.isArray(value) ? value : [value]).map(answer => labels.get(answer) || answer).join(', ');
          return `Answered ${displayed} to “${branchQuestionLabel(question)}”`;
        });
        if (item.pageSkipped) reason.textContent = waiting ? 'Depends on its page rule' : 'Page rule did not match';
        else if (waiting) reason.textContent = `Waiting for ${sourceNames(item.pending)}`;
        else {
          const skipped = item.skippedSources.length ? `${sourceNames(item.skippedSources)} did not appear on this path` : '';
          reason.textContent = [...failedAnswers, skipped].filter(Boolean).join(' · ') || 'Conditions did not match';
        }
        row.append(reason);
      }
      results.append(row);
    }
    if (!results.children.length) {
      const empty = document.createElement('p');
      empty.className = 'branch-test-empty';
      empty.textContent = 'This session has no conditional measures.';
      results.append(empty);
    }
    reset.disabled = !Object.keys(answers).length;
  }

  function renderInputs() {
    fields.replaceChildren();
    for (const id of evaluate().sources) {
      const question = questionById(id);
      if (!question) continue;
      const field = document.createElement('div');
      field.className = 'branch-test-field';
      const label = document.createElement('span');
      label.textContent = branchQuestionLabel(question);
      const value = branchValueControl(question, answers[id] ?? '', ['checkbox', 'body_map'].includes(question.type));
      value.setAttribute('aria-label', label.textContent);
      value.addEventListener('input', () => {
        const answer = readBranchValue(value);
        if (answer === '' || (Array.isArray(answer) && !answer.length)) delete answers[id];
        else answers[id] = answer;
        update();
      });
      field.append(label, value);
      fields.append(field);
    }
    update();
  }
  reset.onclick = () => {
    for (const id of Object.keys(answers)) delete answers[id];
    renderInputs();
    fields.querySelector('input, select')?.focus();
  };
  renderInputs();
  dialog.addEventListener('branch-change', renderInputs);
  dialog.querySelector('.branch-preview-link').onclick = () => {
    dialog.close();
    previewSession = session.id;
    renderPreviewTabs();
    renderPreview();
    document.getElementById('builder-preview-btn').click();
  };
  dialog.addEventListener('close', () => {
    dialog.removeEventListener('branch-change', renderInputs);
    if (!document.body.classList.contains('preview-open') && trigger.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  if (matchMedia('(min-width: 1051px)').matches) {
    dialog.show();
    dialog.querySelector('[autofocus]').focus({ preventScroll: true });
    dialog.onkeydown = event => {
      if (event.key === 'Escape') dialog.close();
    };
  } else {
    dialog.onkeydown = null;
    dialog.showModal();
  }
}
