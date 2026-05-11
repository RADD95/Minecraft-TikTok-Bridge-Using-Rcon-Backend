const { EventEmitter } = require("events");

const DEFAULT_USER_ID = 1;
const DEFAULT_ACK_TIMEOUT_MS = 30000;

class AudioService extends EventEmitter {
  constructor() {
    super();
    this.pendingCues = new Map();
    this.cueIndex = new Map();
    this.userQueues = new Map();
    // Map userId -> Set(cueId) to allow multiple concurrent cues per user
    this.activeCuesByUser = new Map();
  }

  normalizeUserId(userId) {
    return Number.isInteger(Number(userId)) ? Number(userId) : DEFAULT_USER_ID;
  }

  _createCue(payload = {}) {
    const userId = this.normalizeUserId(payload.userId);
    const now = Date.now();

    return {
      id: `audio-${now}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      asset: String(payload.asset || "").trim(),
      volume: Math.max(0, Math.min(100, Number.parseInt(payload.volume, 10) || 70)),
      actionName: String(payload.actionName || "").trim(),
      eventType: String(payload.eventType || "event").trim(),
      waitForFinish: !!payload.waitForFinish,
      replaceCurrent: !!payload.replaceCurrent,
      timeoutMs: Math.max(3000, Math.min(120000, Number.parseInt(payload.timeoutMs, 10) || DEFAULT_ACK_TIMEOUT_MS)),
      createdAt: now
    };
  }

  _emitState(userId = DEFAULT_USER_ID, reason = "update") {
    const uid = this.normalizeUserId(userId);
    const pending = Array.from(this.pendingCues.values()).filter((item) => String(item.userId) === String(uid)).length;
    const currentSet = this.activeCuesByUser.get(uid);
    const currentCueIds = currentSet ? Array.from(currentSet) : [];

    this.emit("state", {
      userId: uid,
      reason,
      pending,
      currentCueIds
    });
  }

  _createWaiter(cue) {
    let resolve;
    let reject;

    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve, reject, timeoutHandle: null };
  }

  _getQueue(userId) {
    const uid = this.normalizeUserId(userId);
    if (!this.userQueues.has(uid)) {
      this.userQueues.set(uid, []);
    }

    return this.userQueues.get(uid);
  }

  _startCue(entry) {
    if (!entry?.cue) return;

    const cue = entry.cue;
    entry.startedAt = Date.now();

    if (entry.waiter) {
      entry.waiter.timeoutHandle = setTimeout(() => {
        this.finishCue(cue.id, {
          status: "timeout",
          reason: "ack-timeout"
        });
      }, cue.timeoutMs);
    }

    this.emit("cue", cue);
    this._emitState(cue.userId, "cue-start");
  }

  _pumpUserQueue(userId) {
    const uid = this.normalizeUserId(userId);

    const queue = this._getQueue(uid);

    // Ensure we have a Set for active cues
    if (!this.activeCuesByUser.has(uid)) this.activeCuesByUser.set(uid, new Set());

    while (queue.length > 0) {
      const nextCueId = queue.shift();
      const entry = this.pendingCues.get(nextCueId);

      if (!entry) continue;

      // Start the cue immediately (concurrent by default)
      const activeSet = this.activeCuesByUser.get(uid);
      activeSet.add(nextCueId);
      this._startCue(entry);
      // continue to start next queued cues as well
    }

    const activeSetAfter = this.activeCuesByUser.get(uid);
    if (!activeSetAfter || activeSetAfter.size === 0) {
      this.activeCuesByUser.delete(uid);
      this._emitState(uid, "idle");
    } else {
      this._emitState(uid, "update");
    }
  }

  _replacePendingForUser(userId, keepCueId = null) {
    const uid = this.normalizeUserId(userId);
    // Stop any active cues for this user (except keepCueId) and clear queue
    const activeSet = this.activeCuesByUser.get(uid);
    if (activeSet) {
      for (const activeCueId of Array.from(activeSet)) {
        if (activeCueId === keepCueId) continue;
        this.finishCue(activeCueId, {
          status: "stopped",
          reason: "replaced-by-new"
        });
      }
    }

    const queue = this._getQueue(uid);
    const queuedIds = [...queue];
    queue.length = 0;

    for (const queuedCueId of queuedIds) {
      if (queuedCueId === keepCueId) continue;
      this.finishCue(queuedCueId, {
        status: "stopped",
        reason: "replaced-by-new"
      });
    }
  }

  async enqueue(payload = {}) {
    const cue = this._createCue(payload);

    if (!cue.asset) {
      return {
        accepted: false,
        skipped: true,
        reason: "missing-asset"
      };
    }

    const waiter = this._createWaiter(cue);

    this.pendingCues.set(cue.id, {
      cue,
      waiter,
      startedAt: null
    });

    this.cueIndex.set(cue.id, cue.userId);

    if (cue.replaceCurrent) {
      this._replacePendingForUser(cue.userId, cue.id);
    }

    this._getQueue(cue.userId).push(cue.id);
    this._pumpUserQueue(cue.userId);

    if (!cue.waitForFinish) {
      return {
        accepted: true,
        cueId: cue.id,
        queued: true
      };
    }

    return waiter.promise;
  }

  finishCue(cueId, payload = {}) {
    const id = String(cueId || "").trim();
    if (!id) return { success: false, error: "cueId requerido" };

    const uid = this.cueIndex.get(id);
    if (uid == null) {
      return { success: false, error: "Cue no encontrada" };
    }

    const entry = this.pendingCues.get(id);
    if (!entry) {
      return { success: false, error: "Cue no activa" };
    }

    if (entry.waiter?.timeoutHandle) {
      clearTimeout(entry.waiter.timeoutHandle);
    }

    const durationMs = entry.startedAt ? Date.now() - entry.startedAt : 0;
    const cue = entry.cue;

    if (entry.waiter?.resolve) {
      entry.waiter.resolve({
        accepted: true,
        cueId: id,
        status: payload.status || "finished",
        durationMs
      });
    }

    this.emit("finished", {
      userId: uid,
      cueId: id,
      status: payload.status || "finished",
      reason: payload.reason || null,
      durationMs,
      cue
    });

    this.emit("stop", {
      userId: uid,
      cueId: id,
      status: payload.status || "finished",
      reason: payload.reason || null,
      durationMs,
      cue
    });

    this.pendingCues.delete(id);
    this.cueIndex.delete(id);

    const queue = this.userQueues.get(uid);
    if (Array.isArray(queue) && queue.length > 0) {
      this.userQueues.set(
        uid,
        queue.filter((queuedId) => queuedId !== id)
      );
    }

    // Remove from active set if present
    const activeSet = this.activeCuesByUser.get(uid);
    if (activeSet && activeSet.has(id)) {
      activeSet.delete(id);
      if (activeSet.size === 0) {
        this.activeCuesByUser.delete(uid);
        this._emitState(uid, "idle");
      } else {
        this._emitState(uid, "cue-finished");
      }
    } else {
      this._emitState(uid, "cue-finished");
    }

    return {
      success: true,
      userId: uid,
      cueId: id,
      durationMs,
      status: payload.status || "finished"
    };
  }

  finishCueForUser(cueId, userId, payload = {}) {
    const id = String(cueId || "").trim();
    const uid = this.normalizeUserId(userId);
    const owner = this.cueIndex.get(id);

    if (owner == null || String(owner) !== String(uid)) {
      return {
        success: false,
        error: "Cue no pertenece al usuario"
      };
    }

    return this.finishCue(id, payload);
  }
}

module.exports = new AudioService();