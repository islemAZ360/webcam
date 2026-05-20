import { useState, useRef, useEffect } from 'react';
import { Camera, Video, VideoOff, SwitchCamera, Zap, ZapOff, Settings, Activity, Monitor, FileText, X, Focus, Sun, Palette, Contrast, Eye } from 'lucide-react';
import { db } from './firebase';
import { collection, doc, getDoc, setDoc, updateDoc, onSnapshot, addDoc } from 'firebase/firestore';
import './index.css';

const servers = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302'
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

function App() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('disconnected');
  const [errorMsg, setErrorMsg] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [currentCameraId, setCurrentCameraId] = useState(null);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  
  const [localStream, setLocalStream] = useState(null);
  
  const [torchOn, setTorchOn] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [exposure, setExposure] = useState(0);
  const [capabilities, setCapabilities] = useState({});
  
  // Smart Resolution & FPS States
  const [supportedModes, setSupportedModes] = useState([]);
  const [currentModeIndex, setCurrentModeIndex] = useState(0);
  const [resolution, setResolution] = useState('1080P');
  const [targetFps, setTargetFps] = useState(30);
  const [actualResolution, setActualResolution] = useState('1080P');
  const [actualFps, setActualFps] = useState(30);
  const [isProbing, setIsProbing] = useState(false);
  
  // Advanced Camera Controls
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [focusMode, setFocusMode] = useState('continuous');
  const [focusDistance, setFocusDistance] = useState(0);
  const [whiteBalanceMode, setWhiteBalanceMode] = useState('continuous');
  const [colorTemperature, setColorTemperature] = useState(5500);
  const [iso, setIso] = useState(100);
  const [contrast, setContrast] = useState(50);
  const [saturation, setSaturation] = useState(50);
  const [sharpness, setSharpness] = useState(50);
  const [brightness, setBrightness] = useState(50);
  
  // Teleprompter States
  const [teleprompter, setTeleprompter] = useState(null);
  const [showTeleprompterOverlay, setShowTeleprompterOverlay] = useState(false);
  
  const localVideoRef = useRef(null);
  
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomRef = useRef(null);
  const hasProbed = useRef(false);

  useEffect(() => {
    if (localVideoRef.current && localStream && isCameraActive) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isCameraActive]);

  // Probe camera for exact supported resolution+fps combos
  const probeCameraModes = async (deviceIdOrMode) => {
    const allModes = [
      { label: '4K', width: 3840, height: 2160 },
      { label: '1080P', width: 1920, height: 1080 },
      { label: '720P', width: 1280, height: 720 },
      { label: '480P', width: 854, height: 480 },
    ];
    const fpsOptions = [60, 30];
    const results = [];
    
    for (const mode of allModes) {
      for (const fps of fpsOptions) {
        let videoConstraints = {
          width: { exact: mode.width },
          height: { exact: mode.height },
          frameRate: { exact: fps }
        };
        if (deviceIdOrMode && deviceIdOrMode !== 'user' && deviceIdOrMode !== 'environment') {
          videoConstraints.deviceId = { exact: deviceIdOrMode };
        } else if (deviceIdOrMode) {
          videoConstraints.facingMode = deviceIdOrMode;
        }
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints, audio: false
          });
          const track = testStream.getVideoTracks()[0];
          const settings = track.getSettings();
          const realFps = Math.round(settings.frameRate || fps);
          const realW = Math.max(settings.width || 0, settings.height || 0);
          testStream.getTracks().forEach(t => t.stop());
          
          // Verify the hardware actually delivered what we asked
          let verifiedLabel = mode.label;
          if (realW < mode.width * 0.8) continue; // Hardware couldn't deliver
          
          results.push({ label: verifiedLabel, width: mode.width, height: mode.height, fps: realFps });
        } catch (e) {
          // Not supported, skip
        }
      }
    }
    
    // Deduplicate (same label+fps)
    const unique = [];
    const seen = new Set();
    for (const r of results) {
      const key = `${r.label}_${r.fps}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
    }
    
    // Sort: highest resolution first, then highest fps
    unique.sort((a, b) => {
      if (b.width !== a.width) return b.width - a.width;
      return b.fps - a.fps;
    });
    
    return unique.length > 0 ? unique : [{ label: '480P', width: 854, height: 480, fps: 30 }];
  };

  // Initialize camera
  const startCamera = async (mode = facingMode, res = resolution, fps = targetFps) => {
    try {
      const oldStream = localStreamRef.current;
      
      const width = res === '4K' ? 3840 : res === '1080P' ? 1920 : res === '720P' ? 1280 : 854;
      const height = res === '4K' ? 2160 : res === '1080P' ? 1080 : res === '720P' ? 720 : 480;
      
      let videoConstraints = {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: fps }
      };

      if (mode !== 'user' && mode !== 'environment') {
        videoConstraints.deviceId = { exact: mode };
      } else {
        videoConstraints.facingMode = mode;
      }
      
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: true
        });
      } catch (err) {
        console.warn('Initial camera constraints failed, retrying with minimal...', err);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: videoConstraints.deviceId ? videoConstraints.deviceId : undefined },
          audio: true
        });
      }
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      } else {
        setLocalStream(stream);
      }
      setIsCameraActive(true);

      if (oldStream && oldStream !== stream) {
        oldStream.getTracks().forEach(track => track.stop());
      }
      
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      setCurrentCameraId(settings.deviceId);

      if (cameras.length === 0) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setCameras(videoDevices);
      }
      
      const actualW = Math.max(settings.width || 0, settings.height || 0);
      let detectedLabel = '480P';
      if (actualW >= 3840) detectedLabel = '4K';
      else if (actualW >= 1920) detectedLabel = '1080P';
      else if (actualW >= 1280) detectedLabel = '720P';
      
      setActualResolution(detectedLabel);
      if (settings.frameRate) setActualFps(Math.round(settings.frameRate));
      
      if (track.getCapabilities) {
        const caps = track.getCapabilities();
        setCapabilities(caps);
        if (caps.zoom && !zoom) setZoom(caps.zoom.min || 1);
        if (caps.focusDistance) setFocusDistance(caps.focusDistance.min || 0);
        if (caps.colorTemperature) setColorTemperature(settings.colorTemperature || 5500);
        if (caps.iso) setIso(settings.iso || caps.iso.min || 100);
        if (caps.contrast) setContrast(settings.contrast || caps.contrast.min || 50);
        if (caps.saturation) setSaturation(settings.saturation || caps.saturation.min || 50);
        if (caps.sharpness) setSharpness(settings.sharpness || caps.sharpness.min || 50);
        if (caps.brightness) setBrightness(settings.brightness || caps.brightness.min || 50);
        if (settings.focusMode) setFocusMode(settings.focusMode);
        if (settings.whiteBalanceMode) setWhiteBalanceMode(settings.whiteBalanceMode);
      }
      
      // Fast mode estimate from capabilities (no extra streams = no stutter)
      if (!hasProbed.current && track.getCapabilities) {
        const caps = track.getCapabilities();
        const maxW = Math.max(caps.width?.max || 0, caps.height?.max || 0);
        const maxFps = caps.frameRate?.max || 30;
        const estimated = [];
        const resList = [
          { label: '4K', width: 3840, height: 2160 },
          { label: '1080P', width: 1920, height: 1080 },
          { label: '720P', width: 1280, height: 720 },
          { label: '480P', width: 854, height: 480 },
        ];
        for (const r of resList) {
          if (maxW >= r.width) {
            if (maxFps >= 58) estimated.push({ ...r, fps: 60 });
            estimated.push({ ...r, fps: 30 });
          }
        }
        if (estimated.length === 0) estimated.push({ label: '480P', width: 854, height: 480, fps: 30 });
        setSupportedModes(estimated);
        const idx = estimated.findIndex(m => m.label === detectedLabel && Math.abs(m.fps - (settings.frameRate || 30)) < 5);
        setCurrentModeIndex(idx >= 0 ? idx : 0);
      }
      
      return stream;
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Camera error: ' + err.message + '\nTry refreshing or picking another lens.');
      setErrorMsg('Cannot access camera. Please allow permissions.');
      return null;
    }
  };

  // Helper: replace WebRTC tracks after camera change
  const replaceWebRTCTracks = async (stream) => {
    if (pcRef.current && stream) {
      try {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        const senders = pcRef.current.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) await videoSender.replaceTrack(videoTrack);
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender && audioTrack) await audioSender.replaceTrack(audioTrack);
      } catch (err) {
        console.error('Track replacement failed:', err);
      }
    }
  };

  // Apply a camera constraint (advanced setting)
  const applyAdvancedConstraint = async (constraintObj) => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({ advanced: [constraintObj] });
    } catch (err) {
      console.warn('Constraint not supported:', constraintObj, err);
    }
  };

  const toggleTorch = async () => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    if (capabilities.torch) {
      try {
        await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
        setTorchOn(!torchOn);
      } catch (err) {
        console.error("Torch error", err);
      }
    }
  };

  const handleZoomChange = async (e) => {
    const newZoom = parseFloat(e.target.value);
    setZoom(newZoom);
    applyAdvancedConstraint({ zoom: newZoom });
  };

  const handleExposureChange = async (e) => {
    const newExp = parseFloat(e.target.value);
    setExposure(newExp);
    applyAdvancedConstraint({ exposureCompensation: newExp });
  };

  const handleFocusModeChange = async (mode) => {
    setFocusMode(mode);
    applyAdvancedConstraint({ focusMode: mode });
  };

  const handleFocusDistanceChange = async (e) => {
    const val = parseFloat(e.target.value);
    setFocusDistance(val);
    applyAdvancedConstraint({ focusDistance: val });
  };

  const handleWhiteBalanceModeChange = async (mode) => {
    setWhiteBalanceMode(mode);
    applyAdvancedConstraint({ whiteBalanceMode: mode });
  };

  const handleColorTemperatureChange = async (e) => {
    const val = parseFloat(e.target.value);
    setColorTemperature(val);
    applyAdvancedConstraint({ colorTemperature: val });
  };

  const handleIsoChange = async (e) => {
    const val = parseFloat(e.target.value);
    setIso(val);
    applyAdvancedConstraint({ iso: val });
  };

  const handleContrastChange = async (e) => {
    const val = parseFloat(e.target.value);
    setContrast(val);
    applyAdvancedConstraint({ contrast: val });
  };

  const handleSaturationChange = async (e) => {
    const val = parseFloat(e.target.value);
    setSaturation(val);
    applyAdvancedConstraint({ saturation: val });
  };

  const handleSharpnessChange = async (e) => {
    const val = parseFloat(e.target.value);
    setSharpness(val);
    applyAdvancedConstraint({ sharpness: val });
  };

  const handleBrightnessChange = async (e) => {
    const val = parseFloat(e.target.value);
    setBrightness(val);
    applyAdvancedConstraint({ brightness: val });
  };

  // Open settings and run deep probe if not done yet
  const openSettingsPanel = () => {
    setShowSettingsPanel(true);
    if (!hasProbed.current) {
      hasProbed.current = true;
      setIsProbing(true);
      const probeTarget = currentCameraId || facingMode;
      probeCameraModes(probeTarget).then(modes => {
        setSupportedModes(modes);
        const idx = modes.findIndex(m => m.label === actualResolution && Math.abs(m.fps - actualFps) < 5);
        setCurrentModeIndex(idx >= 0 ? idx : 0);
        setIsProbing(false);
        // Restart current camera to restore the stream after probing
        const modeToUse = currentCameraId || facingMode;
        startCamera(modeToUse, resolution, targetFps).then(replaceWebRTCTracks);
      });
    }
  };

  // Cycle through detected modes (resolution + fps)
  const toggleMode = () => {
    if (supportedModes.length === 0) return;
    const nextIdx = (currentModeIndex + 1) % supportedModes.length;
    const nextMode = supportedModes[nextIdx];
    setCurrentModeIndex(nextIdx);
    setResolution(nextMode.label);
    setTargetFps(nextMode.fps);
    
    const modeToUse = currentCameraId || facingMode;
    startCamera(modeToUse, nextMode.label, nextMode.fps).then(replaceWebRTCTracks);
  };

  // Toggle FPS for the current resolution
  const toggleFps = () => {
    if (supportedModes.length === 0) return;
    // Find next mode with same resolution but different fps
    const currentMode = supportedModes[currentModeIndex];
    const sameLabelModes = supportedModes.map((m, i) => ({ ...m, idx: i })).filter(m => m.label === currentMode.label);
    if (sameLabelModes.length <= 1) return; // No other fps option
    const currentInSame = sameLabelModes.findIndex(m => m.idx === currentModeIndex);
    const nextInSame = (currentInSame + 1) % sameLabelModes.length;
    const nextMode = sameLabelModes[nextInSame];
    setCurrentModeIndex(nextMode.idx);
    setTargetFps(nextMode.fps);
    
    const modeToUse = currentCameraId || facingMode;
    startCamera(modeToUse, nextMode.label, nextMode.fps).then(replaceWebRTCTracks);
  };

  const switchCameraTo = (deviceId, index) => {
    setCurrentCameraIndex(index);
    setShowCameraMenu(false);
    hasProbed.current = false; // Re-probe for new camera
    startCamera(deviceId).then(replaceWebRTCTracks);
  };

  const toggleCamera = () => {
    if (cameras.length > 1) {
      setShowCameraMenu(!showCameraMenu);
    } else {
      const newMode = facingMode === 'user' ? 'environment' : 'user';
      setFacingMode(newMode);
      hasProbed.current = false;
      startCamera(newMode).then(replaceWebRTCTracks);
    }
  };

  const connectToPC = async (e) => {
    e.preventDefault();
    if (!code || code.length < 6) {
      setErrorMsg('Please enter a valid 6-digit code.');
      return;
    }

    setStatus('connecting');
    setErrorMsg('');

    try {
      // 1. Get Camera
      let stream = localStreamRef.current;
      if (!stream) {
        stream = await startCamera();
      }
      if (!stream) {
        setStatus('error');
        return;
      }

      // 2. Initialize Peer Connection
      const pc = new RTCPeerConnection(servers);
      pcRef.current = pc;

      // Add local stream tracks to PC
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // 3. Setup Firestore refs
      const roomsCollection = collection(db, 'rooms');
      const roomDocument = doc(roomsCollection, code);
      roomRef.current = roomDocument;

      // Check if room exists
      const roomSnapshot = await getDoc(roomDocument);
      if (!roomSnapshot.exists()) {
        setErrorMsg('Code not found. Please make sure the PC app is running and the code is correct.');
        setStatus('error');
        return;
      }

      // 4. Create Offer
      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
      };

      await updateDoc(roomDocument, { offer });

      // 5. Listen for remote answer and teleprompter
      onSnapshot(roomDocument, (snapshot) => {
        const data = snapshot.data();
        if (data) {
          if (!pc.currentRemoteDescription && data.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answerDescription);
            setStatus('connected');
          }
          if (data.teleprompter) {
            setTeleprompter(data.teleprompter);
            if (!data.teleprompter.isActive) {
              setShowTeleprompterOverlay(false);
            }
          }
        }
      });

      // 6. Listen for remote ICE candidates
      const calleeCandidatesCollection = collection(roomDocument, 'calleeCandidates');
      onSnapshot(calleeCandidatesCollection, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            pc.addIceCandidate(new RTCIceCandidate(data));
          }
        });
      });

      // 7. Send local ICE candidates
      const callerCandidatesCollection = collection(roomDocument, 'callerCandidates');
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          await addDoc(callerCandidatesCollection, event.candidate.toJSON());
        }
      };

      pc.onconnectionstatechange = (event) => {
        if (pc.connectionState === 'disconnected') {
          setStatus('disconnected');
          stopConnection();
        }
      };

    } catch (err) {
      console.error(err);
      setErrorMsg('Connection failed. Please try again.');
      setStatus('error');
    }
  };

  const stopConnection = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setStatus('disconnected');
  };

  return (
    <>
      {/* Connection Screen */}
      {!isCameraActive && (
        <>
          <div className="status-badge" style={{ position: 'absolute', top: '2rem', left: '2rem' }}>
            <div className={`dot ${status}`}></div>
            {status === 'disconnected' ? 'Disconnected' : 
             status === 'connecting' ? 'Connecting...' : 
             status === 'connected' ? 'Connected' : 'Error'}
          </div>

          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <div style={{ background: 'rgba(99, 102, 241, 0.15)', padding: '1rem', borderRadius: '50%' }}>
                <Camera size={36} color="var(--primary)" />
              </div>
            </div>
            <h1>Connect to PC</h1>
            <p>Enter the 6-digit code shown on your computer screen to start streaming.</p>
            
            {errorMsg && (
              <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.85rem', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                {errorMsg}
              </div>
            )}

            <form onSubmit={connectToPC} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input 
                type="text" 
                maxLength="6"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <button type="submit" disabled={status === 'connecting' || code.length < 6}>
                {status === 'connecting' ? (
                  <><div className="loader"></div> Connecting...</>
                ) : (
                  <><Video size={20} /> Start Streaming</>
                )}
              </button>
            </form>
          </div>
        </>
      )}

      {/* Camera Layout */}
      {isCameraActive && (
        <div className="camera-layout">
          {/* Top Controls */}
          <div className="cam-top-controls">
            <div className="cam-top-left">
              <button className="ctrl-btn" onClick={toggleTorch} disabled={!capabilities.torch}>
                {torchOn ? <Zap size={20} color="#facc15" fill="#facc15" /> : <ZapOff size={20} color="#fff" />}
              </button>
            </div>

            <div className="cam-top-center">
              {teleprompter && teleprompter.isActive ? (
                <button 
                  className={`ctrl-btn ${showTeleprompterOverlay ? 'active' : ''}`}
                  onClick={() => setShowTeleprompterOverlay(!showTeleprompterOverlay)}
                >
                  <FileText size={20} color="#818cf8" />
                </button>
              ) : (
                <button className="ctrl-btn" disabled>
                  <FileText size={20} color="#fff" />
                </button>
              )}

              <button className="ctrl-btn" onClick={toggleMode}>
                <div className="res-badge">
                  <span>{actualResolution}</span>
                  <span className="fps-tag" onClick={(e) => { e.stopPropagation(); toggleFps(); }}>{actualFps}</span>
                </div>
              </button>
            </div>

            <div className="cam-top-right">
              <button className="ctrl-btn" onClick={openSettingsPanel}>
                <Settings size={20} color={showSettingsPanel ? '#818cf8' : '#fff'} />
              </button>
            </div>
          </div>

          {/* Camera Preview */}
          <div className="cam-preview-area">
            <div className="cam-preview-frame">
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)' }}
              />
            </div>
          </div>

          {/* Teleprompter Overlay (full screen) */}
          {showTeleprompterOverlay && teleprompter && teleprompter.isActive && (
            <div className="teleprompter-overlay">
              <div className="teleprompter-header">
                <span className="tp-name">{teleprompter.name}</span>
                <span className="tp-counter">{teleprompter.currentIndex + 1} / {teleprompter.parts.length}</span>
              </div>
              <div className="teleprompter-content">
                <p className="teleprompter-text" style={{
                  fontSize: (() => {
                    const text = teleprompter.parts[teleprompter.currentIndex] || '';
                    const len = text.length;
                    if (len < 80) return '1.6rem';
                    if (len < 150) return '1.35rem';
                    if (len < 250) return '1.15rem';
                    if (len < 400) return '1rem';
                    if (len < 600) return '0.88rem';
                    if (len < 900) return '0.78rem';
                    return '0.7rem';
                  })()
                }}>
                  {teleprompter.parts[teleprompter.currentIndex]}
                </p>
              </div>
            </div>
          )}

          {/* Settings Panel */}
          {showSettingsPanel && (
            <div className="settings-panel-overlay" onClick={() => setShowSettingsPanel(false)}>
              <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-panel-header">
                  <h3 className="settings-panel-title">Camera Settings</h3>
                  <button className="ctrl-btn" onClick={() => setShowSettingsPanel(false)} style={{ width: 32, height: 32 }}>
                    <X size={16} color="#fff" />
                  </button>
                </div>
                
                <div className="settings-panel-body">
                  {/* Mode Info */}
                  {supportedModes.length > 0 && (
                    <div className="settings-section">
                      <div className="settings-section-title">Supported Modes</div>
                      <div className="mode-chips">
                        {supportedModes.map((m, i) => (
                          <button 
                            key={i}
                            className={`mode-chip ${i === currentModeIndex ? 'active' : ''}`}
                            onClick={() => {
                              setCurrentModeIndex(i);
                              setResolution(m.label);
                              setTargetFps(m.fps);
                              const modeToUse = currentCameraId || facingMode;
                              startCamera(modeToUse, m.label, m.fps).then(replaceWebRTCTracks);
                            }}
                          >
                            {m.label} <span className="mode-chip-fps">{m.fps}fps</span>
                          </button>
                        ))}
                      </div>
                      {isProbing && <div className="settings-probing">Detecting camera capabilities...</div>}
                    </div>
                  )}

                  {/* Zoom */}
                  {capabilities.zoom && (
                    <div className="settings-section">
                      <div className="settings-section-title">Zoom</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.zoom.min} max={capabilities.zoom.max} step={capabilities.zoom.step || 0.1} value={zoom} onChange={handleZoomChange} className="slider-track" />
                        <span className="slider-value">{zoom.toFixed(1)}x</span>
                      </div>
                    </div>
                  )}

                  {/* Exposure */}
                  {capabilities.exposureCompensation && (
                    <div className="settings-section">
                      <div className="settings-section-title">Exposure</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.exposureCompensation.min} max={capabilities.exposureCompensation.max} step={capabilities.exposureCompensation.step || 0.1} value={exposure} onChange={handleExposureChange} className="slider-track" />
                        <span className="slider-value">{exposure > 0 ? '+' : ''}{exposure.toFixed(1)}</span>
                      </div>
                    </div>
                  )}

                  {/* Focus */}
                  {capabilities.focusMode && (
                    <div className="settings-section">
                      <div className="settings-section-title">Focus</div>
                      <div className="settings-toggle-row">
                        {capabilities.focusMode.map(mode => (
                          <button key={mode} className={`settings-toggle ${focusMode === mode ? 'active' : ''}`} onClick={() => handleFocusModeChange(mode)}>
                            {mode === 'continuous' ? 'Auto' : mode === 'manual' ? 'Manual' : mode === 'single-shot' ? 'Tap' : mode}
                          </button>
                        ))}
                      </div>
                      {focusMode === 'manual' && capabilities.focusDistance && (
                        <div className="slider-row" style={{ marginTop: '0.5rem' }}>
                          <input type="range" min={capabilities.focusDistance.min} max={capabilities.focusDistance.max} step={capabilities.focusDistance.step || 0.01} value={focusDistance} onChange={handleFocusDistanceChange} className="slider-track" />
                          <span className="slider-value">{focusDistance.toFixed(1)}m</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* White Balance */}
                  {capabilities.whiteBalanceMode && (
                    <div className="settings-section">
                      <div className="settings-section-title">White Balance</div>
                      <div className="settings-toggle-row">
                        {capabilities.whiteBalanceMode.map(mode => (
                          <button key={mode} className={`settings-toggle ${whiteBalanceMode === mode ? 'active' : ''}`} onClick={() => handleWhiteBalanceModeChange(mode)}>
                            {mode === 'continuous' ? 'Auto' : mode === 'manual' ? 'Manual' : mode}
                          </button>
                        ))}
                      </div>
                      {whiteBalanceMode === 'manual' && capabilities.colorTemperature && (
                        <div className="slider-row" style={{ marginTop: '0.5rem' }}>
                          <input type="range" min={capabilities.colorTemperature.min} max={capabilities.colorTemperature.max} step={capabilities.colorTemperature.step || 50} value={colorTemperature} onChange={handleColorTemperatureChange} className="slider-track wb-slider" />
                          <span className="slider-value">{colorTemperature}K</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ISO */}
                  {capabilities.iso && (
                    <div className="settings-section">
                      <div className="settings-section-title">ISO</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.iso.min} max={capabilities.iso.max} step={capabilities.iso.step || 1} value={iso} onChange={handleIsoChange} className="slider-track" />
                        <span className="slider-value">{Math.round(iso)}</span>
                      </div>
                    </div>
                  )}

                  {/* Brightness */}
                  {capabilities.brightness && (
                    <div className="settings-section">
                      <div className="settings-section-title">Brightness</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.brightness.min} max={capabilities.brightness.max} step={capabilities.brightness.step || 1} value={brightness} onChange={handleBrightnessChange} className="slider-track" />
                        <span className="slider-value">{Math.round(brightness)}</span>
                      </div>
                    </div>
                  )}

                  {/* Contrast */}
                  {capabilities.contrast && (
                    <div className="settings-section">
                      <div className="settings-section-title">Contrast</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.contrast.min} max={capabilities.contrast.max} step={capabilities.contrast.step || 1} value={contrast} onChange={handleContrastChange} className="slider-track" />
                        <span className="slider-value">{Math.round(contrast)}</span>
                      </div>
                    </div>
                  )}

                  {/* Saturation */}
                  {capabilities.saturation && (
                    <div className="settings-section">
                      <div className="settings-section-title">Saturation</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.saturation.min} max={capabilities.saturation.max} step={capabilities.saturation.step || 1} value={saturation} onChange={handleSaturationChange} className="slider-track" />
                        <span className="slider-value">{Math.round(saturation)}</span>
                      </div>
                    </div>
                  )}

                  {/* Sharpness */}
                  {capabilities.sharpness && (
                    <div className="settings-section">
                      <div className="settings-section-title">Sharpness</div>
                      <div className="slider-row">
                        <input type="range" min={capabilities.sharpness.min} max={capabilities.sharpness.max} step={capabilities.sharpness.step || 1} value={sharpness} onChange={handleSharpnessChange} className="slider-track" />
                        <span className="slider-value">{Math.round(sharpness)}</span>
                      </div>
                    </div>
                  )}

                  {/* No advanced caps */}
                  {!capabilities.focusMode && !capabilities.whiteBalanceMode && !capabilities.iso && !capabilities.contrast && !capabilities.saturation && !capabilities.brightness && !capabilities.sharpness && (
                    <div className="settings-probing" style={{ textAlign: 'center', padding: '1.5rem' }}>No advanced camera controls available on this device.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sliders (quick access: zoom only) */}
          {capabilities.zoom && (
            <div className="cam-sliders">
              <div className="slider-row">
                <span className="slider-label">Zoom</span>
                <input type="range" min={capabilities.zoom.min} max={capabilities.zoom.max} step={capabilities.zoom.step || 0.1} value={zoom} onChange={handleZoomChange} className="slider-track" />
                <span className="slider-value">{zoom.toFixed(1)}x</span>
              </div>
            </div>
          )}

          {/* Bottom Controls */}
          <div className="cam-bottom-controls">
            <div className="cam-status-indicator">
              <Monitor size={22} color="#fff" />
              <div className={`status-dot ${status}`}></div>
            </div>
            
            <button className="stop-btn" onClick={stopConnection} title="Stop Camera">
              <div className="stop-btn-inner"></div>
            </button>

            <div style={{ position: 'relative' }}>
              {showCameraMenu && cameras.length > 1 && (
                <div className="camera-menu">
                  <div className="camera-menu-title">Select Camera</div>
                  {cameras.map((cam, idx) => {
                    let label = cam.label || `Camera ${idx + 1}`;
                    if (label.includes('front')) label = `Front Camera`;
                    else if (label.includes('back')) {
                      if (label.includes('0,')) label = `Main Back Camera`;
                      else if (label.includes('1,')) label = `Ultra Wide / Telephoto`;
                      else label = `Back Camera ${idx}`;
                    }
                    
                    return (
                      <button 
                        key={cam.deviceId}
                        className={`camera-menu-item ${currentCameraId === cam.deviceId ? 'selected' : ''}`}
                        onClick={() => switchCameraTo(cam.deviceId, idx)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              
              <button className="switch-cam-btn" onClick={toggleCamera}>
                <SwitchCamera size={24} color="#fff" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
