import { useCallback, useEffect, useRef, useState } from 'react';
import type { Member, VoiceSignalPayload } from '../types';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface Options {
  me: string | null;
  members: Member[];
  connected: boolean;
  sendVoiceState(inVoice: boolean, muted: boolean, deafened: boolean): void;
  sendVoiceSignal(to: string | null, type: VoiceSignalPayload['type'], data?: unknown): void;
  setVoiceSignalListener(fn: ((sig: VoiceSignalPayload) => void) | null): void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  iceQueue: RTCIceCandidateInit[];
  audioEl: HTMLAudioElement;
  cleanupAnalyser?: () => void;
}

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

/**
 * Quản lý Voice Chat WebRTC kiểu Discord + công cụ Test Mic (Let's Check) & Test Loa.
 */
export function useVoiceChat({
  me,
  members,
  connected,
  sendVoiceState,
  sendVoiceSignal,
  setVoiceSignalListener,
}: Options) {
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [demoMic, setDemoMic] = useState(false);
  const [usingFallbackMic, setUsingFallbackMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0); // 0..100
  const [sensitivity, setSensitivity] = useState(12); // ngưỡng phát hiện đang nói (0..60)
  const [micGainPct, setMicGainPct] = useState(100); // 0..200%
  const [outputVolPct, setOutputVolPct] = useState(100); // 0..100%
  const [speakingIds, setSpeakingIds] = useState<Record<string, boolean>>({});
  const [peerStatuses, setPeerStatuses] = useState<Record<string, RTCPeerConnectionState>>({});
  const [micDevices, setMicDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const outStreamRef = useRef<MediaStream | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const loopbackGainRef = useRef<GainNode | null>(null);
  const synthStopRef = useRef<(() => void) | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());

  const inVoiceRef = useRef(false);
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const testingMicRef = useRef(false);
  const sensitivityRef = useRef(12);
  const outputVolRef = useRef(1);
  const meRef = useRef<string | null>(null);
  const lastSpeakingSentRef = useRef(false);

  inVoiceRef.current = inVoice;
  mutedRef.current = muted;
  deafenedRef.current = deafened;
  testingMicRef.current = testingMic;
  sensitivityRef.current = sensitivity;
  outputVolRef.current = outputVolPct / 100;
  meRef.current = me;

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const mics = list
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${idx + 1}`,
        }));
      setMicDevices(mics);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  /** Tạo nguồn âm thanh giả lập nhịp nói chuyện (dùng khi máy không có mic vật lý hoặc bật chế độ Demo Mic). */
  const createSyntheticSpeechStream = useCallback((ctx: AudioContext) => {
    const dest = ctx.createMediaStreamDestination();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const cadenceGain = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.value = 210;
    osc2.type = 'sine';
    osc2.frequency.value = 420;

    cadenceGain.gain.value = 0.25;
    osc1.connect(cadenceGain);
    osc2.connect(cadenceGain);
    cadenceGain.connect(dest);

    osc1.start();
    osc2.start();

    // Tạo nhịp điệu lên xuống giống giọng nói tự nhiên
    let step = 0;
    const timer = window.setInterval(() => {
      step++;
      const talking = step % 5 !== 0;
      const target = talking ? 0.12 + (step % 3) * 0.08 : 0.005;
      cadenceGain.gain.setTargetAtTime(target, ctx.currentTime, 0.06);
      osc1.frequency.setTargetAtTime(185 + ((step * 29) % 90), ctx.currentTime, 0.08);
    }, 260);

    const stop = () => {
      window.clearInterval(timer);
      try {
        osc1.stop();
        osc2.stop();
        osc1.disconnect();
        osc2.disconnect();
        cadenceGain.disconnect();
      } catch {
        /* ignore */
      }
    };
    return { stream: dest.stream, stop };
  }, []);

  /** Khởi tạo luồng thu âm (Mic thật hoặc Demo Mic) + bộ đo âm lượng + loopback test mic. */
  const startAudioPipeline = useCallback(
    async (forceDemo = demoMic) => {
      const ctx = ensureAudioContext();

      // Dọn luồng cũ nếu có
      if (levelTimerRef.current) {
        window.clearInterval(levelTimerRef.current);
        levelTimerRef.current = null;
      }
      synthStopRef.current?.();
      synthStopRef.current = null;
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawStreamRef.current = null;

      let sourceStream: MediaStream;
      let fallback = false;

      if (!forceDemo && navigator.mediaDevices?.getUserMedia) {
        try {
          const constraints: MediaStreamConstraints = {
            audio: selectedMicId
              ? {
                  deviceId: { exact: selectedMicId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                }
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
          };
          sourceStream = await navigator.mediaDevices.getUserMedia(constraints);
          setVoiceError(null);
          void refreshDevices();
        } catch {
          // Tự động chuyển sang luồng giả lập nếu máy không gắn mic để vẫn test/voice được
          const synth = createSyntheticSpeechStream(ctx);
          sourceStream = synth.stream;
          synthStopRef.current = synth.stop;
          fallback = true;
          setVoiceError('Không tìm thấy Mic vật lý — đang dùng tín hiệu âm thanh giả lập để test.');
        }
      } else {
        const synth = createSyntheticSpeechStream(ctx);
        sourceStream = synth.stream;
        synthStopRef.current = synth.stop;
        fallback = true;
      }

      setUsingFallbackMic(fallback);
      rawStreamRef.current = sourceStream;

      const srcNode = ctx.createMediaStreamSource(sourceStream);
      const micGain = ctx.createGain();
      micGain.gain.value = micGainPct / 100;
      micGainNodeRef.current = micGain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;

      // Nhánh phát sang WebRTC peers
      const rtcDest = ctx.createMediaStreamDestination();
      srcNode.connect(micGain);
      micGain.connect(analyser);
      micGain.connect(rtcDest);

      // Nhánh Loopback có trễ nhẹ (0.14s) giống Discord "Let's Check" để tự nghe lại giọng mình khi Test Mic
      const delayNode = ctx.createDelay(1.0);
      delayNode.delayTime.value = 0.14;
      const loopGain = ctx.createGain();
      loopGain.gain.value = testingMicRef.current ? 0.85 : 0;
      loopbackGainRef.current = loopGain;

      micGain.connect(delayNode);
      delayNode.connect(loopGain);
      loopGain.connect(ctx.destination);

      const processedStream = rtcDest.stream;
      processedStream.getAudioTracks().forEach((t) => {
        t.enabled = !mutedRef.current && !deafenedRef.current;
      });
      outStreamRef.current = processedStream;

      // Cập nhật track mới cho các peer đang kết nối
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
        const newTrack = processedStream.getAudioTracks()[0];
        if (sender && newTrack) {
          void sender.replaceTrack(newTrack);
        }
      });

      const data = new Uint8Array(analyser.frequencyBinCount);
      levelTimerRef.current = window.setInterval(() => {
        if (mutedRef.current && !testingMicRef.current) {
          setMicLevel(0);
          const myId = meRef.current;
          if (myId) {
            setSpeakingIds((prev) => (prev[myId] ? { ...prev, [myId]: false } : prev));
          }
          if (lastSpeakingSentRef.current && inVoiceRef.current) {
            lastSpeakingSentRef.current = false;
            sendVoiceSignal(null, 'speaking', false);
          }
          return;
        }
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const level = Math.min(100, Math.round((avg / 95) * 100));
        setMicLevel(level);

        const isSpeakingNow = level >= sensitivityRef.current && !mutedRef.current && !deafenedRef.current;
        const myId = meRef.current;
        if (myId) {
          setSpeakingIds((prev) => (prev[myId] === isSpeakingNow ? prev : { ...prev, [myId]: isSpeakingNow }));
        }
        if (inVoiceRef.current && isSpeakingNow !== lastSpeakingSentRef.current) {
          lastSpeakingSentRef.current = isSpeakingNow;
          sendVoiceSignal(null, 'speaking', isSpeakingNow);
        }
      }, 80);

      return processedStream;
    },
    [createSyntheticSpeechStream, demoMic, ensureAudioContext, micGainPct, refreshDevices, selectedMicId, sendVoiceSignal],
  );

  const stopAudioPipelineIfIdle = useCallback((nextInVoice: boolean, nextTesting: boolean) => {
    if (nextInVoice || nextTesting) return;
    if (levelTimerRef.current) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    synthStopRef.current?.();
    synthStopRef.current = null;
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
    outStreamRef.current?.getTracks().forEach((t) => t.stop());
    outStreamRef.current = null;
    setMicLevel(0);
  }, []);

  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    entry.cleanupAnalyser?.();
    entry.audioEl.pause();
    entry.audioEl.srcObject = null;
    entry.pc.close();
    peersRef.current.delete(peerId);
    setPeerStatuses((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setSpeakingIds((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(() => {
    Array.from(peersRef.current.keys()).forEach((id) => closePeer(id));
  }, [closePeer]);

  /** Khởi tạo RTCPeerConnection tới 1 thành viên trong phòng. */
  const getOrCreatePeer = useCallback(
    (peerId: string, initiator: boolean): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.muted = deafenedRef.current;
      audioEl.volume = outputVolRef.current;

      const entry: PeerEntry = { pc, iceQueue: [], audioEl };
      peersRef.current.set(peerId, entry);

      const localStream = outStreamRef.current;
      if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendVoiceSignal(peerId, 'ice', ev.candidate.toJSON());
        }
      };

      pc.onconnectionstatechange = () => {
        setPeerStatuses((prev) => ({ ...prev, [peerId]: pc.connectionState }));
      };

      pc.ontrack = (ev) => {
        const [remoteStream] = ev.streams;
        if (!remoteStream) return;
        audioEl.srcObject = remoteStream;
        void audioEl.play().catch(() => {
          /* chờ cử chỉ người dùng nếu bị chặn */
        });

        // Đo âm lượng của peer từ xa để bật vòng sáng xanh khi họ nói
        try {
          const ctx = ensureAudioContext();
          const src = ctx.createMediaStreamSource(remoteStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const timer = window.setInterval(() => {
            analyser.getByteFrequencyData(buf);
            let s = 0;
            for (let i = 0; i < buf.length; i++) s += buf[i];
            const talking = s / buf.length > 10;
            setSpeakingIds((prev) => (prev[peerId] === talking ? prev : { ...prev, [peerId]: talking }));
          }, 100);
          entry.cleanupAnalyser = () => {
            window.clearInterval(timer);
            try {
              src.disconnect();
            } catch {
              /* ignore */
            }
          };
        } catch {
          /* ignore */
        }
      };

      if (initiator) {
        void (async () => {
          try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            sendVoiceSignal(peerId, 'offer', pc.localDescription);
          } catch {
            /* ignore */
          }
        })();
      }

      return entry;
    },
    [ensureAudioContext, sendVoiceSignal],
  );

  // Lắng nghe tín hiệu WebRTC từ các thành viên khác
  useEffect(() => {
    setVoiceSignalListener((sig: VoiceSignalPayload) => {
      const myId = meRef.current;
      if (!myId || sig.from === myId) return;
      if (sig.to && sig.to !== myId) return;

      if (sig.type === 'speaking') {
        const talking = Boolean(sig.data);
        setSpeakingIds((prev) => ({ ...prev, [sig.from]: talking }));
        return;
      }

      if (!inVoiceRef.current) return;

      if (sig.type === 'hello') {
        // Người mới vừa vào kênh thoại -> chủ động tạo kết nối và gửi Offer cho họ
        closePeer(sig.from);
        getOrCreatePeer(sig.from, true);
        return;
      }

      if (sig.type === 'offer' && sig.data) {
        void (async () => {
          closePeer(sig.from);
          const entry = getOrCreatePeer(sig.from, false);
          try {
            await entry.pc.setRemoteDescription(new RTCSessionDescription(sig.data as RTCSessionDescriptionInit));
            for (const cand of entry.iceQueue) {
              await entry.pc.addIceCandidate(new RTCIceCandidate(cand));
            }
            entry.iceQueue = [];
            const answer = await entry.pc.createAnswer();
            await entry.pc.setLocalDescription(answer);
            sendVoiceSignal(sig.from, 'answer', entry.pc.localDescription);
          } catch {
            /* ignore */
          }
        })();
        return;
      }

      if (sig.type === 'answer' && sig.data) {
        const entry = peersRef.current.get(sig.from);
        if (!entry) return;
        void (async () => {
          try {
            await entry.pc.setRemoteDescription(new RTCSessionDescription(sig.data as RTCSessionDescriptionInit));
            for (const cand of entry.iceQueue) {
              await entry.pc.addIceCandidate(new RTCIceCandidate(cand));
            }
            entry.iceQueue = [];
          } catch {
            /* ignore */
          }
        })();
        return;
      }

      if (sig.type === 'ice' && sig.data) {
        const entry = peersRef.current.get(sig.from);
        if (!entry) return;
        const cand = sig.data as RTCIceCandidateInit;
        if (entry.pc.remoteDescription) {
          void entry.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => undefined);
        } else {
          entry.iceQueue.push(cand);
        }
      }
    });

    return () => setVoiceSignalListener(null);
  }, [closePeer, getOrCreatePeer, sendVoiceSignal, setVoiceSignalListener]);

  // Đồng bộ danh sách peer khi members thay đổi (dọn peer đã rời voice & kết nối với peer đang ở trong voice)
  useEffect(() => {
    if (!inVoice || !me) return;
    const voiceMemberIds = new Set(members.filter((m) => m.inVoice && m.id !== me).map((m) => m.id));
    Array.from(peersRef.current.keys()).forEach((peerId) => {
      if (!voiceMemberIds.has(peerId)) closePeer(peerId);
    });
    voiceMemberIds.forEach((peerId) => {
      if (!peersRef.current.has(peerId) && me < peerId) {
        getOrCreatePeer(peerId, true);
      }
    });
  }, [closePeer, getOrCreatePeer, inVoice, me, members]);

  // Cập nhật âm lượng Mic (GainNode)
  useEffect(() => {
    if (micGainNodeRef.current && audioCtxRef.current) {
      micGainNodeRef.current.gain.setTargetAtTime(micGainPct / 100, audioCtxRef.current.currentTime, 0.03);
    }
  }, [micGainPct]);

  // Cập nhật âm lượng Loa cho toàn bộ các peer
  useEffect(() => {
    peersRef.current.forEach(({ audioEl }) => {
      audioEl.volume = outputVolPct / 100;
      audioEl.muted = deafened;
    });
  }, [outputVolPct, deafened]);

  // Bật/tắt tiếng loopback khi bấm Test Mic
  useEffect(() => {
    if (loopbackGainRef.current && audioCtxRef.current) {
      loopbackGainRef.current.gain.setTargetAtTime(testingMic ? 0.85 : 0, audioCtxRef.current.currentTime, 0.03);
    }
  }, [testingMic]);

  /** Phát âm báo Discord khi vào/rời kênh thoại hoặc bấm Test Loa. */
  const playTone = useCallback(
    (kind: 'join' | 'leave' | 'test') => {
      try {
        const ctx = ensureAudioContext();
        const now = ctx.currentTime;
        const notes =
          kind === 'join'
            ? [440, 587.33]
            : kind === 'leave'
              ? [523.25, 349.23]
              : [523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.001, now + i * 0.11);
          gain.gain.exponentialRampToValueAtTime(0.18 * outputVolRef.current, now + i * 0.11 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.14);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.11);
          osc.stop(now + i * 0.11 + 0.15);
        });
      } catch {
        /* ignore */
      }
    },
    [ensureAudioContext],
  );

  const joinVoice = useCallback(async () => {
    if (!connected || inVoiceRef.current) return;
    await startAudioPipeline(demoMic);
    setInVoice(true);
    inVoiceRef.current = true;
    playTone('join');
    sendVoiceState(true, mutedRef.current, deafenedRef.current);
    sendVoiceSignal(null, 'hello');
  }, [connected, demoMic, playTone, sendVoiceSignal, sendVoiceState, startAudioPipeline]);

  const leaveVoice = useCallback(() => {
    if (!inVoiceRef.current) return;
    setInVoice(false);
    inVoiceRef.current = false;
    closeAllPeers();
    playTone('leave');
    sendVoiceState(false, mutedRef.current, deafenedRef.current);
    stopAudioPipelineIfIdle(false, testingMicRef.current);
    if (meRef.current) {
      const myId = meRef.current;
      setSpeakingIds((prev) => ({ ...prev, [myId]: false }));
    }
  }, [closeAllPeers, playTone, sendVoiceState, stopAudioPipelineIfIdle]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    setMuted(next);
    mutedRef.current = next;
    outStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next && !deafenedRef.current;
    });
    if (inVoiceRef.current) {
      sendVoiceState(true, next, deafenedRef.current);
    }
  }, [sendVoiceState]);

  const toggleDeafen = useCallback(() => {
    const next = !deafenedRef.current;
    setDeafened(next);
    deafenedRef.current = next;
    const nextMuted = next ? true : mutedRef.current;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;
    outStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted && !next;
    });
    peersRef.current.forEach(({ audioEl }) => {
      audioEl.muted = next;
    });
    if (inVoiceRef.current) {
      sendVoiceState(true, nextMuted, next);
    }
  }, [sendVoiceState]);

  const toggleTestMic = useCallback(async () => {
    const next = !testingMicRef.current;
    setTestingMic(next);
    testingMicRef.current = next;
    if (next) {
      if (!outStreamRef.current) {
        await startAudioPipeline(demoMic);
      } else if (loopbackGainRef.current && audioCtxRef.current) {
        loopbackGainRef.current.gain.setTargetAtTime(0.85, audioCtxRef.current.currentTime, 0.03);
      }
    } else {
      if (loopbackGainRef.current && audioCtxRef.current) {
        loopbackGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.03);
      }
      stopAudioPipelineIfIdle(inVoiceRef.current, false);
    }
  }, [demoMic, startAudioPipeline, stopAudioPipelineIfIdle]);

  const toggleDemoMic = useCallback(
    async (next: boolean) => {
      setDemoMic(next);
      if (inVoiceRef.current || testingMicRef.current) {
        await startAudioPipeline(next);
      }
    },
    [startAudioPipeline],
  );

  // Dọn dẹp khi rời trang
  useEffect(() => {
    return () => {
      if (levelTimerRef.current) window.clearInterval(levelTimerRef.current);
      synthStopRef.current?.();
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      outStreamRef.current?.getTracks().forEach((t) => t.stop());
      closeAllPeers();
    };
  }, [closeAllPeers]);

  return {
    inVoice,
    muted,
    deafened,
    testingMic,
    demoMic,
    usingFallbackMic,
    micLevel,
    sensitivity,
    setSensitivity,
    micGainPct,
    setMicGainPct,
    outputVolPct,
    setOutputVolPct,
    speakingIds,
    peerStatuses,
    micDevices,
    selectedMicId,
    setSelectedMicId,
    voiceError,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    toggleTestMic,
    toggleDemoMic,
    playTestSpeaker: () => playTone('test'),
  };
}
