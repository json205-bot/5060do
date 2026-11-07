import assert from "node:assert/strict";
import { mergeProgramPage } from "../src/lib/programs.ts";

const PAGE_SIZE = 30;

const remainingRatio = (program) =>
  program.capacity > 0
    ? Math.max(0, program.capacity - (program.enrolled ?? 0)) / program.capacity
    : 1;

const makeOpenProgram = (id, enrolled) => ({
  id,
  title: `가상 접수중 강좌 ${id}`,
  category: "가상",
  summary: "",
  capacity: 1000,
  enrolled,
  location: "오륙도인생후반전지원센터",
  fee: 0,
  target: "신중년",
  applyPeriod: "2026-11-01 ~ 2026-11-30",
  eduPeriod: "2026-12-01 ~ 2026-12-20",
  status: "접수중",
  sourceUrl: "",
});

// 40 open courses whose remaining ratios span (0, 1]. The first page holds the
// 30 most full courses in reverse order and the second page holds the rest, so
// only a cross-page merge can produce a globally ascending order.
const allOpen = Array.from({ length: 40 }, (_, index) => {
  const ratio = index / 39;
  return makeOpenProgram(1000 + index, Math.round(1000 * (1 - ratio)));
}).sort((a, b) => remainingRatio(b) - remainingRatio(a));

const firstPage = allOpen.slice(0, PAGE_SIZE);
const secondPage = allOpen.slice(PAGE_SIZE);

assert.equal(firstPage.length, 30, "first page must hold 30 rows");
assert.equal(secondPage.length, 10, "second page must hold 10 rows");

const merged = mergeProgramPage(firstPage, secondPage);

assert.equal(merged.length, 40, "merged list must keep all 40 rows");
assert.equal(
  new Set(merged.map((program) => program.id)).size,
  40,
  "merged list must not duplicate ids",
);
assert.ok(
  merged.every((program) => program.status === "접수중"),
  "every merged row must stay 접수중",
);

const ratios = merged.map(remainingRatio);
assert.equal(ratios[0], 0, "the most full course (ratio 0.0) must come first");
assert.equal(ratios.at(-1), 1, "the empty course (ratio 1.0) must come last");
for (let index = 1; index < ratios.length; index += 1) {
  assert.ok(
    ratios[index] >= ratios[index - 1],
    `remaining ratio must ascend at index ${index}: ${ratios[index - 1]} -> ${ratios[index]}`,
  );
}

const mergedAgain = mergeProgramPage(merged, secondPage);
assert.equal(
  mergedAgain.length,
  40,
  "re-merging an already merged page must not duplicate rows",
);

const closedRows = [
  { ...makeOpenProgram(1, 1000), status: "마감", id: 1 },
  { ...makeOpenProgram(2, 1000), status: "마감", id: 2 },
  { ...makeOpenProgram(3, 1000), status: "마감", id: 3 },
];
const appendedOpen = makeOpenProgram(4, 500);
const mixed = mergeProgramPage(closedRows, [appendedOpen]);
assert.deepEqual(
  mixed.filter((program) => program.status === "마감").map((program) => program.id),
  [1, 2, 3],
  "non-접수중 rows must keep their original order",
);

console.log("unit-merge-programs: PASS (40 open courses, ratios 0.0 -> 1.0)");
