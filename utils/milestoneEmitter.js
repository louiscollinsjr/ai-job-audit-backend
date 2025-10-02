class MilestoneEmitter {
  constructor() {
    this.sessions = new Map();
  }

  initSession(sessionId) {
    if (!sessionId) return;
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        milestones: [],
        startTime: Date.now()
      });
    }
  }

  emit(sessionId, milestone) {
    if (!sessionId || !milestone) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const event = {
      ...milestone,
      timestamp: Date.now(),
      elapsed: Date.now() - session.startTime
    };

    session.milestones.push(event);
    console.log('[Milestone]', sessionId, event);
  }

  getMilestones(sessionId, since = 0) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.milestones.filter((m) => m.timestamp > since);
  }

  complete(sessionId) {
    if (!sessionId) return;
    setTimeout(() => {
      this.sessions.delete(sessionId);
    }, 30000);
  }
}

module.exports = new MilestoneEmitter();
