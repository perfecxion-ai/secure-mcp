import assert from 'node:assert/strict';

// Compare package identities and edges, not npm's installation paths or BOM UUIDs.
// Duplicate installations of the same package are collapsed only when their
// integrity identifiers agree. The build root has no archive integrity yet.
export function productionGraph(sbom, rootPurl) {
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.ok(Array.isArray(sbom.components) && Array.isArray(sbom.dependencies));
  const wrapper = sbom.metadata?.component;
  assert.ok(wrapper?.purl && wrapper['bom-ref'], 'Missing SBOM root');
  const components = [wrapper, ...sbom.components];
  const refs = new Map();
  for (const component of components) {
    assert.ok(
      typeof component.purl === 'string' &&
        component.purl.startsWith('pkg:npm/') &&
        typeof component.version === 'string' &&
        typeof component['bom-ref'] === 'string',
      'Invalid npm component',
    );
    assert.ok(!refs.has(component['bom-ref']), 'Duplicate component reference');
    refs.set(component['bom-ref'], component);
  }
  const edges = new Map();
  for (const dependency of sbom.dependencies) {
    assert.ok(refs.has(dependency.ref), 'Unknown dependency source');
    assert.ok(!edges.has(dependency.ref), 'Duplicate dependency source');
    assert.ok(Array.isArray(dependency.dependsOn), 'Missing dependency targets');
    for (const ref of dependency.dependsOn) assert.ok(refs.has(ref), 'Unknown dependency target');
    edges.set(dependency.ref, dependency.dependsOn);
  }
  assert.ok(
    components.some((component) => component.purl === rootPurl),
    'Package root missing',
  );
  if (wrapper.purl !== rootPurl) {
    assert.deepEqual(
      [...new Set((edges.get(wrapper['bom-ref']) ?? []).map((ref) => refs.get(ref).purl))],
      [rootPurl],
      'Consumer must contain only the candidate as a direct dependency',
    );
  }
  const packages = new Map();
  for (const component of components) {
    if (component === wrapper && wrapper.purl !== rootPurl) continue;
    assert.ok(edges.has(component['bom-ref']), 'Missing dependency entry');
    const integrity =
      component.purl === rootPurl
        ? []
        : (component.hashes ?? [])
            .map(({ alg, content }) => {
              assert.ok(typeof alg === 'string' && typeof content === 'string');
              return `${alg}:${content.toLowerCase()}`;
            })
            .sort();
    const targets = edges.get(component['bom-ref']).map((ref) => refs.get(ref).purl);
    assert.ok(
      !targets.includes(wrapper.purl) || wrapper.purl === rootPurl,
      'Edge to consumer wrapper',
    );
    const prior = packages.get(component.purl);
    if (prior) assert.deepEqual(prior.integrity, integrity, 'Conflicting duplicate integrity');
    packages.set(component.purl, {
      purl: component.purl,
      version: component.version,
      integrity,
      dependencies: [...new Set([...(prior?.dependencies ?? []), ...targets])].sort(),
    });
  }
  return [...packages.values()].sort((a, b) => a.purl.localeCompare(b.purl));
}

export function compareProductionGraphs(buildSbom, consumerSbom) {
  const rootPurl = buildSbom.metadata?.component?.purl;
  assert.ok(typeof rootPurl === 'string', 'Build SBOM root missing');
  const build = productionGraph(buildSbom, rootPurl);
  const consumer = productionGraph(consumerSbom, rootPurl);
  const expected = new Map(build.map((entry) => [entry.purl, entry]));
  const actual = new Map(consumer.map((entry) => [entry.purl, entry]));
  const added = consumer.filter((entry) => !expected.has(entry.purl));
  const removed = build.filter((entry) => !actual.has(entry.purl));
  const changed = consumer
    .filter(
      (entry) =>
        expected.has(entry.purl) &&
        JSON.stringify(entry) !== JSON.stringify(expected.get(entry.purl)),
    )
    .map((entry) => ({ purl: entry.purl, build: expected.get(entry.purl), consumer: entry }));
  return {
    result: added.length || removed.length || changed.length ? 'different' : 'match',
    root: rootPurl,
    comparison:
      'production package identities, integrity identifiers and dependency edges; layout duplicates collapsed',
    added,
    removed,
    changed,
    build,
    consumer,
  };
}
