/**
 * Regression tests for the reputation score: the score must be the WEIGHTED
 * composite described by WEIGHTS (check-ins 0.15, board activity 0.25,
 * ratings received 0.25, on-chain reputation 0.20, level 0.15), not the
 * unweighted sum of the components.
 *
 * Bug: computeScore() computed the weighted total and then returned the
 * unweighted raw sum instead, so the documented weights had no effect on
 * any score, tier, or /api/gate decision. E.g. an agent with 100 check-ins
 * and nothing else scored 17.4 (Newcomer, may claim bounties) when the
 * weighted composite is 2.6 (Observer, may claim nothing).
 *
 * Run: npm test   (node --test, no extra dependencies)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeScore, getTier, TIERS, type AgentData } from "../src/index.ts";

function agent(overrides: Partial<AgentData>): AgentData {
  return {
    btcAddress: "bc1qtest",
    displayName: "Test Agent",
    checkIns: 0,
    level: 0,
    score: 0,
    boardProjects: 0,
    boardDeliverables: 0,
    boardGoals: 0,
    boardRatingsGiven: 0,
    avgRatingReceived: 0,
    ratingsReceivedCount: 0,
    onChainFeedbackScore: 0,
    onChainFeedbackCount: 0,
    ...overrides,
  };
}

describe("computeScore returns the weighted composite", () => {
  it("check-ins-only agent: 100 check-ins scores 2.6, not 17.4", () => {
    // checkInPts = log10(100) * 8.7 = 17.4; weighted = 17.4 * 0.15 = 2.6
    const { total } = computeScore(agent({ checkIns: 100 }));
    assert.equal(total, 2.6);
  });

  it("mixed agent: 1000 check-ins + level 3 scores 6.9, not 46.1", () => {
    // checkInPts = 26.1 * 0.15 = 3.9; levelPts = 20 * 0.15 = 3.0
    const { total } = computeScore(agent({ checkIns: 1000, level: 3 }));
    assert.equal(total, 6.9);
  });

  it("maxed agent scores 33.5, not 160", () => {
    // 30*0.15 + 40*0.25 + 40*0.25 + 30*0.20 + 20*0.15 = 33.5
    const { total } = computeScore(
      agent({
        checkIns: 10000,
        boardProjects: 8,
        avgRatingReceived: 5,
        ratingsReceivedCount: 4,
        onChainFeedbackScore: 10,
        level: 3,
      })
    );
    assert.equal(total, 33.5);
  });

  it("breakdown is the weighted contribution of each factor and sums to total", () => {
    const { total, breakdown } = computeScore(agent({ checkIns: 100 }));
    assert.equal(breakdown.checkIns, 2.6);
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - total) < 0.11, `breakdown sums to ${sum}, total is ${total}`);
  });

  it("a factor with weight 0.15 cannot outrank a factor with weight 0.25 at equal points", () => {
    // 17.4 check-in points vs 17.4 board points: board must score higher.
    const checkInsOnly = computeScore(agent({ checkIns: 100 })).total;
    // board: 3 projects (15) + 1 deliverable (3) = 18 pts -> 18 * 0.25 = 4.5
    // check-ins: 100 -> 17.4 pts -> 17.4 * 0.15 = 2.6
    const boardOnly = computeScore(
      agent({ boardProjects: 3, boardDeliverables: 1 })
    ).total;
    assert.equal(checkInsOnly, 2.6);
    assert.equal(boardOnly, 4.5);
    assert.ok(boardOnly > checkInsOnly);
  });
});

describe("tiers are calibrated to the weighted scale", () => {
  it("tier cutoffs are reachable: max weighted score is 33.5 and Core is below it", () => {
    const core = TIERS.find((t) => t.name === "Core")!;
    assert.ok(core.minScore <= 33.5, `Core minScore ${core.minScore} unreachable`);
    assert.equal(getTier(33.5).name, "Core");
  });

  it("30 check-ins is Observer (1.9), not Newcomer as the raw sum claimed (12.9)", () => {
    // checkInPts = log10(30) * 8.7 = 12.9; weighted = 12.9 * 0.15 = 1.9
    const { total } = computeScore(agent({ checkIns: 30 }));
    assert.equal(total, 1.9);
    assert.equal(getTier(total).name, "Observer");
  });

  it("mixed agent (1000 check-ins + level 3) is Newcomer, not Builder", () => {
    const { total } = computeScore(agent({ checkIns: 1000, level: 3 }));
    assert.equal(getTier(total).name, "Newcomer");
  });

  it("Observer cannot claim bounties (maxBountyValue 0)", () => {
    const { total } = computeScore(agent({ checkIns: 30 }));
    assert.equal(getTier(total).maxBountyValue, 0);
  });
});
