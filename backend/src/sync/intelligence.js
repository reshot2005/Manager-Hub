import { applyApprovedLeaveToAttendance } from './leaveAttendance.js';
import { recomputeRiskScores } from './riskScores.js';
import { evaluateDailyAlerts } from './alerts.js';

/**
 * Post-sync intelligence pipeline:
 * 1) Leave overlay (always — cheap, keeps Absent vs On Leave correct)
 * 2) Risk scores (once per IST day unless force)
 * 3) Alerts (after risk)
 */
export async function runIntelligenceJobs({ force = false } = {}) {
  const stats = {};
  try {
    stats.leave = await applyApprovedLeaveToAttendance(
      Number(process.env.SYNC_ATTENDANCE_LOOKBACK_DAYS || 90)
    );
  } catch (err) {
    stats.leave = { error: err.message };
  }
  try {
    stats.risk = await recomputeRiskScores({ force });
  } catch (err) {
    stats.risk = { error: err.message };
  }
  try {
    // Always evaluate alerts after risk attempt (even if risk skipped — prior day scores exist)
    stats.alerts = await evaluateDailyAlerts();
  } catch (err) {
    stats.alerts = { error: err.message };
  }
  return stats;
}
