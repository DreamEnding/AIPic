module.exports = Object.freeze({
  openai: Object.freeze({ protocol: 'openai', streaming: true, masks: true, maxReferenceImages: 8 }),
  grok: Object.freeze({ protocol: 'openai', streaming: false, masks: true, maxReferenceImages: 8 }),
  xai: Object.freeze({ protocol: 'openai', streaming: false, masks: false, maxReferenceImages: 1 }),
  google: Object.freeze({ protocol: 'google', streaming: false, masks: false, maxReferenceImages: 8 }),
  custom: Object.freeze({ protocol: 'openai', streaming: true, masks: true, maxReferenceImages: 8 }),
});
