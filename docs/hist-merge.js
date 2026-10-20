/* Slår ihop historikrader: samma objekt och samma dag ersätter förra raden (första raden per objekt behålls alltid). Samma funktion som i 4D-planering. */
function histAppendMerged(arr, rows) {
  const out = arr.slice(), last = new Map(), cnt = new Map();
  out.forEach((r, i) => { last.set(r.plan_item_id, i); cnt.set(r.plan_item_id, (cnt.get(r.plan_item_id) || 0) + 1); });
  rows.forEach(n => {
    const i = last.get(n.plan_item_id), c = cnt.get(n.plan_item_id) || 0;
    if (i !== undefined && c >= 2 && String(out[i].recorded_at || "").slice(0, 10) === String(n.recorded_at || "").slice(0, 10)) out[i] = { ...n, id: out[i].id };
    else { out.push(n); last.set(n.plan_item_id, out.length - 1); cnt.set(n.plan_item_id, c + 1); }
  });
  return out;
}

