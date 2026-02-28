#!/usr/bin/env node
/**
 * Cost Report Generator
 *
 * Usage:
 *   node scripts/cost-report.js [days]
 *   npm run cost-report -- 30
 */

const { generateReport } = require('../src/costTracker');

const days = parseInt(process.argv[2]) || 30;
const logFile = process.argv[3] || '/tmp/podcast-costs.jsonl';

console.log(`Generating cost report for the last ${days} days...`);
console.log(`Reading from: ${logFile}`);
console.log();

generateReport(logFile, days);
