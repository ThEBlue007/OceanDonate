function createAlertResumeScheduler({ setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, onError = console.error } = {}) {
    const timers = new Map();

    function cancel(username) {
        const timer = timers.get(username);
        if (!timer) return;
        clearTimeoutFn(timer);
        timers.delete(username);
    }

    function schedule(username, pausedUntil, onResume) {
        const deadline = new Date(pausedUntil).getTime();
        if (typeof username !== 'string' || !username || !Number.isFinite(deadline) || typeof onResume !== 'function') return false;
        cancel(username);
        const timer = setTimeoutFn(() => {
            timers.delete(username);
            Promise.resolve().then(() => onResume(username)).catch(onError);
        }, Math.max(0, deadline - Date.now()));
        timer?.unref?.();
        timers.set(username, timer);
        return true;
    }

    return { schedule, cancel };
}

module.exports = { createAlertResumeScheduler };
