const { EventEmitter } = require("events");

const DEFAULT_USER_ID = 1;
const DEFAULT_ACK_TIMEOUT_MS = 30000;

class AudioService extends EventEmitter {
  constructor() {
    super();
    this.pendingCues = new Map();
    this.cueIndex = new Map();
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

    this.emit("state", {
      userId: uid,
      reason,
      pending,
      currentCueId: null
    });
  }

  _createWaiter(cue) {
    let resolve;
    let reject;

    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timeoutHandle = setTimeout(() => {
      this.finishCue(cue.id, {
        status: "timeout",
        reason: "ack-timeout"
      });
    }, cue.timeoutMs);

    return { promise, resolve, reject, timeoutHandle };
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
      startedAt: Date.now()
    });

    this.cueIndex.set(cue.id, cue.userId);

    this.emit("cue", cue);
    this._emitState(cue.userId, "cue-start");

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

    const durationMs = Date.now() - (entry.startedAt || Date.now());
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

    this.pendingCues.delete(id);
    this.cueIndex.delete(id);
    this._emitState(uid, "cue-finished");

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