import { create } from 'zustand';

export const useAnimationStore = create((set, get) => ({
  enabled: false,
  duration: 120,
  fps: 30,
  currentFrame: 0,
  playing: false,
  loop: true,
  keyframes: {},

  _rafId: null,
  _lastTime: null,

  toggleEnabled: () => set((s) => ({ enabled: !s.enabled })),

  setDuration: (duration) => set({ duration: Math.max(1, Math.round(duration)) }),
  setFps: (fps) => set({ fps: Math.max(1, Math.min(60, Math.round(fps))) }),
  setCurrentFrame: (frame) => {
    const { duration } = get();
    set({ currentFrame: Math.max(0, Math.min(duration, Math.round(frame))) });
  },
  setLoop: (loop) => set({ loop }),

  stepForward: () => {
    const { currentFrame, duration, loop } = get();
    if (currentFrame < duration) {
      set({ currentFrame: currentFrame + 1 });
    } else if (loop) {
      set({ currentFrame: 0 });
    }
  },

  stepBackward: () => {
    const { currentFrame } = get();
    set({ currentFrame: Math.max(0, currentFrame - 1) });
  },

  goToStart: () => set({ currentFrame: 0 }),
  goToEnd: () => set((s) => ({ currentFrame: s.duration })),

  play: () => {
    const state = get();
    if (state.playing) return;
    if (state.currentFrame >= state.duration) {
      set({ currentFrame: 0 });
    }
    set({ playing: true, _lastTime: performance.now() });
    get()._tick();
  },

  pause: () => {
    const { _rafId } = get();
    if (_rafId) cancelAnimationFrame(_rafId);
    set({ playing: false, _rafId: null, _lastTime: null });
  },

  stop: () => {
    const { _rafId } = get();
    if (_rafId) cancelAnimationFrame(_rafId);
    set({ playing: false, currentFrame: 0, _rafId: null, _lastTime: null });
  },

  _tick: () => {
    const rafId = requestAnimationFrame((now) => {
      const state = get();
      if (!state.playing) return;

      const elapsed = now - (state._lastTime || now);
      const frameDuration = 1000 / state.fps;

      if (elapsed >= frameDuration) {
        const nextFrame = state.currentFrame + 1;
        if (nextFrame > state.duration) {
          if (state.loop) {
            set({ currentFrame: 0, _lastTime: now });
          } else {
            set({ playing: false, _rafId: null, _lastTime: null });
            return;
          }
        } else {
          set({ currentFrame: nextFrame, _lastTime: now });
        }
      }

      get()._tick();
    });
    set({ _rafId: rafId });
  },

  setKeyframe: (nodeId, paramId, frame, value, easing = 'easeInOut') => {
    set((s) => {
      const kf = JSON.parse(JSON.stringify(s.keyframes));
      if (!kf[nodeId]) kf[nodeId] = {};
      if (!kf[nodeId][paramId]) kf[nodeId][paramId] = {};
      kf[nodeId][paramId][frame] = { value, easing };
      return { keyframes: kf };
    });
  },

  removeKeyframe: (nodeId, paramId, frame) => {
    set((s) => {
      const kf = JSON.parse(JSON.stringify(s.keyframes));
      if (kf[nodeId]?.[paramId]) {
        delete kf[nodeId][paramId][frame];
        if (Object.keys(kf[nodeId][paramId]).length === 0) {
          delete kf[nodeId][paramId];
        }
        if (Object.keys(kf[nodeId]).length === 0) {
          delete kf[nodeId];
        }
      }
      return { keyframes: kf };
    });
  },

  removeAllKeyframes: (nodeId, paramId) => {
    set((s) => {
      const kf = JSON.parse(JSON.stringify(s.keyframes));
      if (kf[nodeId]) {
        delete kf[nodeId][paramId];
        if (Object.keys(kf[nodeId]).length === 0) delete kf[nodeId];
      }
      return { keyframes: kf };
    });
  },

  setKeyframeEasing: (nodeId, paramId, frame, easing) => {
    set((s) => {
      const kf = JSON.parse(JSON.stringify(s.keyframes));
      if (kf[nodeId]?.[paramId]?.[frame]) {
        kf[nodeId][paramId][frame].easing = easing;
      }
      return { keyframes: kf };
    });
  },

  getNodeKeyframes: (nodeId) => get().keyframes[nodeId] || {},

  hasKeyframes: (nodeId, paramId) => {
    const kf = get().keyframes;
    return !!(kf[nodeId]?.[paramId] && Object.keys(kf[nodeId][paramId]).length > 0);
  },

  getAnimatedTracks: () => {
    const kf = get().keyframes;
    const tracks = [];
    for (const [nodeId, params] of Object.entries(kf)) {
      for (const [paramId, frames] of Object.entries(params)) {
        if (Object.keys(frames).length > 0) {
          tracks.push({ nodeId, paramId, frames });
        }
      }
    }
    return tracks;
  },

  clearAllKeyframes: () => set({ keyframes: {} }),

  loadKeyframes: (keyframes) => set({ keyframes: keyframes || {} }),
  loadAnimationState: (state) => set({
    duration: state.duration ?? 120,
    fps: state.fps ?? 30,
    loop: state.loop ?? true,
    keyframes: state.keyframes ?? {},
    currentFrame: 0,
    playing: false,
  }),
}));
