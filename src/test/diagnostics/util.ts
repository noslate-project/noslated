import urllib from 'urllib';

export async function getInspectorTargets() {
  const result = await urllib.curl('http://localhost:9229/json', {
    dataType: 'json',
  });
  return result.data;
}
