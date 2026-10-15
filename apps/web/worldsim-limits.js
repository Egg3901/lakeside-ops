"use strict";

// 36 calendar years need 1,728 turns, plus the founding campaign offset.
// Keep requests bounded below the worker's independent 5,000-turn backstop.
const MAX_SIM_TURNS = 2000;

function simTurnsSchema(z) {
  return z.number().int().min(1).max(MAX_SIM_TURNS);
}

function assertSimTurns(value) {
  const turns = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(turns) || turns < 1 || turns > MAX_SIM_TURNS)
    throw new Error(`Turns must be between 1 and ${MAX_SIM_TURNS}`);
  return turns;
}

module.exports = { MAX_SIM_TURNS, simTurnsSchema, assertSimTurns };
