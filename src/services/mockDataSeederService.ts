import { db, auth } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { UnifiedSession } from './sessionService';
import { IndexedDbService } from './indexedDbService';
import { store, updateAngle, setPostureHistory, updateVitals } from '../store/store';

export class MockDataSeederService {
  private static getCurrentUserId(): string {
    if (auth.currentUser) return auth.currentUser.uid;
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('current_user_id') || 'guest';
    }
    return 'guest';
  }

  /**
   * Generates rich, realistic clinical posture data for the past 14 days up to today.
   */
  public static generateSessionsTillToday(): UnifiedSession[] {
    const now = new Date();
    const sessions: UnifiedSession[] = [];

    // 14 days of data leading up to today
    // Earliest days (14 days ago) had lower scores (~76-80%), higher Hansraj load (~22 lbs), more slouches.
    // Recent days (last 3-4 days) show dramatic posture improvement (~88-94%), low load (~11-14 lbs).
    for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() - dayOffset);

      // Baseline trend improvements
      const progressFactor = (13 - dayOffset) / 13; // 0.0 to 1.0
      const baseScore = Math.round(76 + progressFactor * 16); // 76 -> 92
      const baseLoad = Math.round((22 - progressFactor * 9) * 10) / 10; // 22 -> 13 lbs
      const baseFatigue = Math.round(42 - progressFactor * 26); // 42% -> 16%
      const baseStability = Math.round(72 + progressFactor * 21); // 72% -> 93%

      // Session 1: Morning Focus Session (10:00 AM)
      const morningDate = new Date(targetDate);
      morningDate.setHours(10, 0, 0, 0);
      const morningDuration = 2700 + Math.floor(Math.random() * 900); // 45-60 mins
      const morningScore = Math.min(96, Math.max(72, baseScore + Math.floor(Math.random() * 5) - 2));
      const morningSlouches = Math.max(1, Math.round(7 - progressFactor * 5));
      const morningGoodSecs = Math.round(morningDuration * (morningScore / 100));
      const morningWarnSecs = morningDuration - morningGoodSecs;

      sessions.push({
        id: `mock-sess-${targetDate.toISOString().split('T')[0]}-am`,
        date: morningDate.toISOString(),
        startTime: morningDate.toISOString(),
        endTime: new Date(morningDate.getTime() + morningDuration * 1000).toISOString(),
        duration: morningDuration,
        score: morningScore,
        slouches: morningSlouches,
        goodSessionSeconds: morningGoodSecs,
        warnSessionSeconds: morningWarnSecs,
        maxFocusStreak: Math.round(morningDuration * 0.45),
        status: morningScore >= 85 ? 'Excellent' : morningScore >= 75 ? 'Fair' : 'Poor',
        avgLoadLbs: baseLoad,
        peakLoadLbs: Math.round((baseLoad + 10 + Math.random() * 4) * 10) / 10,
        fatigueScore: baseFatigue,
        stabilityScore: baseStability,
        complianceRate: Math.min(98, Math.max(75, 78 + Math.round(progressFactor * 18))),
        source: 'local'
      });

      // Session 2: Afternoon Desk Session (2:30 PM)
      const afternoonDate = new Date(targetDate);
      afternoonDate.setHours(14, 30, 0, 0);
      const afternoonDuration = 3600 + Math.floor(Math.random() * 1200); // 60-80 mins
      const afternoonScore = Math.min(95, Math.max(70, baseScore - 2 + Math.floor(Math.random() * 4)));
      const afternoonSlouches = Math.max(1, Math.round(8 - progressFactor * 5));
      const afternoonGoodSecs = Math.round(afternoonDuration * (afternoonScore / 100));
      const afternoonWarnSecs = afternoonDuration - afternoonGoodSecs;

      sessions.push({
        id: `mock-sess-${targetDate.toISOString().split('T')[0]}-pm`,
        date: afternoonDate.toISOString(),
        startTime: afternoonDate.toISOString(),
        endTime: new Date(afternoonDate.getTime() + afternoonDuration * 1000).toISOString(),
        duration: afternoonDuration,
        score: afternoonScore,
        slouches: afternoonSlouches,
        goodSessionSeconds: afternoonGoodSecs,
        warnSessionSeconds: afternoonWarnSecs,
        maxFocusStreak: Math.round(afternoonDuration * 0.5),
        status: afternoonScore >= 85 ? 'Excellent' : afternoonScore >= 75 ? 'Fair' : 'Poor',
        avgLoadLbs: Math.round((baseLoad + 1.2) * 10) / 10,
        peakLoadLbs: Math.round((baseLoad + 12 + Math.random() * 4) * 10) / 10,
        fatigueScore: Math.min(100, baseFatigue + 4),
        stabilityScore: Math.max(60, baseStability - 2),
        complianceRate: Math.min(98, Math.max(75, 76 + Math.round(progressFactor * 18))),
        source: 'local'
      });
    }

    // Sort descending (latest sessions first)
    sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sessions;
  }

  /**
   * Force feeds mock data into all local & cloud storage layers.
   */
  public static async forceFeedMockDataTillDate(overrideUserId?: string): Promise<{ success: boolean; count: number }> {
    const userId = overrideUserId || this.getCurrentUserId();
    const sessions = this.generateSessionsTillToday();

    console.log(`🚀 [MockDataSeeder] Force-feeding ${sessions.length} sessions up to today (${new Date().toLocaleDateString()}) for user: ${userId}`);

    // 1. Save to LocalStorage sessions cache
    const localKey = `posture_sessions_${userId}`;
    localStorage.setItem(localKey, JSON.stringify(sessions));

    // Also populate default guest key if user is guest or demo
    localStorage.setItem('posture_sessions_guest', JSON.stringify(sessions));
    localStorage.setItem('posture_sessions_demo-123', JSON.stringify(sessions));
    localStorage.setItem('login_mode', 'demo');

    // 2. Save to Historical Summaries v2 (used by LocalModelService)
    const v2Summaries = sessions.map(s => ({
      timestamp: s.date,
      durationSeconds: s.duration,
      grade: s.score >= 90 ? 'A' : s.score >= 80 ? 'B' : s.score >= 70 ? 'C' : 'D',
      qualityScore: s.score,
      avgLoadLbs: s.avgLoadLbs || 13.5,
      peakLoadLbs: s.peakLoadLbs || 25.0,
      fatigueScore: s.fatigueScore || 18,
      stabilityScore: s.stabilityScore || 88,
      complianceRate: s.complianceRate || 92,
    }));

    const v2Key = `posturecare_historical_sessions_v2_${userId}`;
    localStorage.setItem(v2Key, JSON.stringify(v2Summaries));
    localStorage.setItem('posturecare_historical_sessions_v2_guest', JSON.stringify(v2Summaries));
    localStorage.setItem('posturecare_historical_sessions_v2_demo-123', JSON.stringify(v2Summaries));

    // 3. Populate Correction Events Log (Realistic fast reaction responses)
    const correctionEvents = [];
    for (let i = 0; i < 20; i++) {
      const pastTime = new Date(Date.now() - (i * 12 * 3600000 + Math.random() * 3600000));
      correctionEvents.push({
        timestamp: pastTime.toISOString(),
        responseTimeSeconds: Math.round((2.2 + Math.random() * 2.8) * 10) / 10,
        corrected: true
      });
    }
    const corrKey = `posturecare_corrections_log_v2_${userId}`;
    localStorage.setItem(corrKey, JSON.stringify(correctionEvents));
    localStorage.setItem('posturecare_corrections_log_v2_guest', JSON.stringify(correctionEvents));

    // 4. Populate Hourly Slouch Distribution Patterns
    const slouchTimePatterns = {
      morningSlouches: 14,
      afternoonSlouches: 26,
      eveningSlouches: 10,
      nightSlouches: 2
    };
    const hourlyKey = `posturecare_historical_hourly_logs_${userId}`;
    localStorage.setItem(hourlyKey, JSON.stringify(slouchTimePatterns));
    localStorage.setItem('posturecare_historical_hourly_logs_guest', JSON.stringify(slouchTimePatterns));

    // 5. Populate Rest Break History
    const breakHistory = [
      {
        id: `break-${Date.now()}-1`,
        startTime: new Date(Date.now() - 3600000 * 3).toISOString(),
        durationSeconds: 180,
        thoracicStressRelief: 85,
        type: 'Scapular Retraction & Shoulder Rolls'
      },
      {
        id: `break-${Date.now()}-2`,
        startTime: new Date(Date.now() - 3600000 * 7).toISOString(),
        durationSeconds: 240,
        thoracicStressRelief: 92,
        type: 'Thoracic Extension Stretch'
      },
      {
        id: `break-${Date.now()}-3`,
        startTime: new Date(Date.now() - 3600000 * 26).toISOString(),
        durationSeconds: 300,
        thoracicStressRelief: 88,
        type: 'Chin Tucks & Hydration Walk'
      }
    ];
    localStorage.setItem('posture_breaks_history', JSON.stringify(breakHistory));
    localStorage.setItem(`posture_breaks_history_${userId}`, JSON.stringify(breakHistory));

    // 6. Save directly into IndexedDB if available
    try {
      for (const s of v2Summaries.slice(0, 15)) {
        await IndexedDbService.saveSession(s);
      }
      for (const c of correctionEvents.slice(0, 10)) {
        await IndexedDbService.saveCorrection(c);
      }
      const todayDateStr = new Date().toISOString().split('T')[0];
      await IndexedDbService.saveSlouchPatterns(todayDateStr, slouchTimePatterns);
    } catch (dbErr) {
      console.warn('[MockDataSeeder] IndexedDB background seed note (handled via localStorage):', dbErr);
    }

    // 7. Sync into Firebase Firestore if user is logged in
    if (auth.currentUser) {
      try {
        const sessionsCol = collection(db, 'users', auth.currentUser.uid, 'sessions');
        // Only write up to 10 latest sessions to Firestore to avoid write limits
        for (const s of sessions.slice(0, 10)) {
          try {
            await addDoc(sessionsCol, {
              date: s.date,
              startTime: s.startTime,
              endTime: s.endTime,
              duration: s.duration,
              score: s.score,
              slouches: s.slouches,
              goodSessionSeconds: s.goodSessionSeconds,
              warnSessionSeconds: s.warnSessionSeconds,
              maxFocusStreak: s.maxFocusStreak,
              status: s.status,
              avgLoadLbs: s.avgLoadLbs,
              peakLoadLbs: s.peakLoadLbs,
              fatigueScore: s.fatigueScore,
              stabilityScore: s.stabilityScore,
              complianceRate: s.complianceRate,
              isMockSeeded: true
            });
          } catch (docErr) {
            // Silently skip duplicate or restricted writes
          }
        }
      } catch (firestoreErr) {
        console.warn('[MockDataSeeder] Firestore sync note:', firestoreErr);
      }
    }

    // 8. Update Active Redux State for Instant Live Visualization
    try {
      // 50 smooth real-time angle points
      const liveAngleWaveform = [
        85, 84, 86, 85, 87, 85, 84, 86, 85, 88,
        86, 85, 84, 85, 87, 86, 85, 84, 85, 86,
        85, 86, 87, 86, 85, 84, 85, 86, 87, 85,
        84, 85, 86, 85, 87, 86, 85, 84, 86, 87,
        85, 84, 86, 85, 87, 86, 85, 84, 85, 86
      ];
      store.dispatch(setPostureHistory(liveAngleWaveform));
      store.dispatch(updateAngle(86));

      // Sync live vitals
      store.dispatch(updateVitals({
        heartRate: 72,
        spo2: 99,
        status: 'live'
      }));
    } catch (reduxErr) {
      console.warn('[MockDataSeeder] Redux live state dispatch note:', reduxErr);
    }

    localStorage.setItem('has_seeded_mock_data_till_date', 'true');
    console.log('✅ [MockDataSeeder] Mock data successfully injected across all layers till date!');

    return { success: true, count: sessions.length };
  }

  /**
   * Auto-run check on startup. If no sessions exist, auto-seed immediately.
   */
  public static autoSeedIfEmpty(): void {
    try {
      const userId = this.getCurrentUserId();
      const localKey = `posture_sessions_${userId}`;
      const existing = localStorage.getItem(localKey);
      const hasSeeded = localStorage.getItem('has_seeded_mock_data_till_date');

      if (!existing || existing === '[]' || !hasSeeded) {
        this.forceFeedMockDataTillDate(userId).catch(err => {
          console.warn('[MockDataSeeder] Auto-seed failed:', err);
        });
      }
    } catch (e) {
      console.warn('[MockDataSeeder] autoSeedIfEmpty check error:', e);
    }
  }
}
