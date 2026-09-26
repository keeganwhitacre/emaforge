"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const place = require('../js/place-context.js');
const validator = require('../js/protocol-validator.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('../js/dashboard/parser.js');

const polygon = (minX, minY, maxX, maxY, indicators) => ({
  type: 'Feature', properties: { indicators }, geometry: { type: 'Polygon', coordinates: [[
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]
  ]] }
});
const dataset = {
  type: 'FeatureCollection',
  metadata: { name: 'Demonstration areas', version: '2026-demo', source_url: 'https://example.org/source', method: 'Illustrative categories; not research data' },
  features: [polygon(-84, 39, -83, 40, { walkability: 'high', pollution: 'low', urbanicity: 'urban' }),
    polygon(-83, 39, -82, 40, { walkability: 'low', pollution: 'high', urbanicity: 'rural' })]
};

test('place lookup returns only documented categories and dataset provenance', () => {
  assert.equal(place.validate(dataset), null);
  const result = place.classify(dataset, 39.5, -83.5, 25);
  assert.deepEqual(result, {
    status: 'classified', indicators: { walkability: 'high', pollution: 'low', urbanicity: 'urban' },
    dataset: 'Demonstration areas', version: '2026-demo'
  });
  assert.doesNotMatch(JSON.stringify(result), /latitude|longitude|coordinates|geometry|area_id/);
  assert.equal(place.classify(dataset, 39.5, -83, 300).status, 'uncertain_boundary');
  assert.equal(place.classify(dataset, 41, -83.5, 25).status, 'outside_study_area');
});

test('place lookup rejects missing sources, raw indicator values, and invalid geometries', () => {
  assert.match(place.validate({ ...dataset, metadata: { ...dataset.metadata, source_url: '' } }), /metadata/);
  assert.match(place.validate({ ...dataset, features: [polygon(-84, 39, -83, 40, { latitude: '39.5' })] }), /indicators/);
  assert.match(place.validate({ ...dataset, features: [{ ...dataset.features[0], geometry: { type: 'Point', coordinates: [-83, 39] } }] }), /Polygon/);
});

test('place context export needs a lookup, researcher acknowledgement, and an optional item', () => {
  const config = {
    study: { name: 'Demo', institution: 'Lab', output_format: 'csv' },
    onboarding: { enabled: true, consent_text: '<p>Approved text goes here</p>' },
    modules: {},
    ema: { questions: [{ id: 'place', type: 'place_context', text: 'Where are you?', required: true }],
      scheduling: { study_days: 1, days_of_week: [1], windows: [
        { id: 'w1', label: 'Day', start: '09:00', end: '10:00', phase_sequence: [{ kind: 'ema', id: 's1', question_ids: ['place'] }] }
      ] } }
  };
  const codes = () => validator.validate(config).errors.map(issue => issue.code);
  assert.ok(codes().includes('place_context_mode'));
  assert.ok(codes().includes('place_context_optional'));
  assert.ok(codes().includes('place_context_terms'));
  config.ema.questions[0].location_mode = 'local_dataset';
  assert.ok(codes().includes('place_context_dataset'));
  Object.assign(config.ema.questions[0], { required: false, location_terms_accepted: true,
    location_mode: 'local_dataset', location_dataset: dataset });
  assert.ok(!codes().some(code => code.startsWith('place_context_')));
  Object.assign(config.ema.questions[0], { location_mode: 'epa_walkability', location_dataset: undefined });
  assert.ok(!codes().some(code => code.startsWith('place_context_')));
  config.ema.questions[0].location_mode = 'census_urbanicity';
  assert.ok(!codes().some(code => code.startsWith('place_context_')));
  config.ema.questions[0].location_mode = 'online_indicators';
  assert.ok(codes().includes('place_context_indicators'));
  config.ema.questions[0].location_indicators = ['walkability', 'urbanicity'];
  assert.ok(!codes().some(code => code.startsWith('place_context_')));
  config.ema.questions[0].location_indicators = ['walkability', 'walkability'];
  assert.ok(codes().includes('place_context_indicators'));
  assert.deepEqual(place.epaWalkability(5.7).indicators, { walkability: 'very_low' });
  assert.deepEqual(place.epaWalkability(16).indicators, { walkability: 'very_high' });
});

test('long-format CSV can preserve place statuses and Analyze counts categorized values', () => {
  const value = place.classify(dataset, 39.5, -83.5, 25);
  const parsed = parser._parseCsvValue('place_context', JSON.stringify(value), '');
  assert.deepEqual(parsed, value);
  const stats = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/dashboard/content-stats.js'), 'utf8') + '\nContentStats');
  const result = stats.compute([{
    participantId: 'P1', day: 1, data: [{ type: 'ema_response', presentationOrder: [['place']],
      responses: { place: { value: parsed, respondedAt: '2026-09-25T12:00:02Z' } }, startedAt: '2026-09-25T12:00:00Z' }]
  }], { ema: { questions: [{ id: 'place', type: 'place_context', text: 'Area?' }] } });
  assert.equal(result.questions[0].statusCounts.classified, 1);
  assert.equal(result.questions[0].indicators.walkability.high, 1);
  const partial = stats.compute([{ participantId: 'P1', day: 1, data: [{ type: 'ema_response',
    responses: { place: { value: { status: 'partial', indicators: { walkability: 'high' },
      indicator_statuses: { walkability: 'classified', urbanicity: 'service_unavailable' } } } } }] }],
    { ema: { questions: [{ id: 'place', type: 'place_context' }] } });
  assert.equal(partial.questions[0].statusCounts.partial, 1);
  assert.equal(partial.questions[0].indicators.walkability.high, 1);
});
