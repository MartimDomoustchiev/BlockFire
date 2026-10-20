/* Worker module: message router (must be the last part added). */
WorkerBundle.add(function entryPart() {
  let BEDROCK = 16;
  function collectBuffers(res) {
    const out = [];
    for (const layer of [res.opaque, res.water]) {
      out.push(layer.pos.buffer, layer.uv.buffer, layer.tile.buffer, layer.shade.buffer, layer.index.buffer);
    }
    return out;
  }
  self.onmessage = function (e) {
    const m = e.data;
    switch (m.type) {
      case 'init':
        BEDROCK = m.ids.BEDROCK;
        setupTerrain(m.ids, m.sea, m.seed, m.cfg);
        setupMesher(m.tables);
        break;
      case 'gen': {
        const data = generateChunk(m.cx, m.cz);
        self.postMessage({ id: m.id, data }, [data.buffer]);
        break;
      }
      case 'mesh': {
        const res = meshChunk(m.blocks, BEDROCK);
        res.id = m.id;
        self.postMessage(res, collectBuffers(res));
        break;
      }
      case 'spawn':
        self.postMessage({ id: m.id, spawn: findSpawn() });
        break;
      case 'plan':
        self.postMessage({ id: m.id, plan: planInfo() });
        break;
    }
  };
});
