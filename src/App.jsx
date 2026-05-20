import { useState, useRef, useEffect } from 'react';
import { Camera, Video, VideoOff, SwitchCamera, Zap, ZapOff, Settings, Activity, Monitor, FileText } from 'lucide-react';
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
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, connected, error
  const [errorMsg, setErrorMsg] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [currentCameraId, setCurrentCameraId] = useState(null);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  
  // Native Camera States
  const [localStream, setLocalStream] = useState(null);
  
  // Native Camera States
  const [torchOn, setTorchOn] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [exposure, setExposure] = useState(0);
  const [capabilities, setCapabilities] = useState({});
  
  // Smart Resolution States
  const [supportedResolutions, setSupportedResolutions] = useState(['480P', '720P', '1080P', '4K']);
  const [resolution, setResolution] = useState('1080P');
  const [actualResolution, setActualResolution] = useState('1080P');
  const [actualFps, setActualFps] = useState(30);
  
  // Teleprompter States
  const [teleprompter, setTeleprompter] = useState(null);
  const [showTeleprompterOverlay, setShowTeleprompterOverlay] = useState(false);
  
  const localVideoRef = useRef(null);
  
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current && localStream && isCameraActive) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isCameraActive]);

  // Initialize camera
  const startCamera = async (mode = facingMode, res = resolution) => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      const width = res === '4K' ? 3840 : res === '1080P' ? 1920 : res === '720P' ? 1280 : 854;
      const height = res === '4K' ? 2160 : res === '1080P' ? 1080 : res === '720P' ? 720 : 480;
      
      let videoConstraints = {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: 30 }
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
        // Fallback if ref is not ready, set directly using state later
        setLocalStream(stream);
      }
      setIsCameraActive(true);
      
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      setCurrentCameraId(settings.deviceId);

      if (cameras.length === 0) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setCameras(videoDevices);
      }
      
      // Determine actual resolution applied by hardware
      const actualW = Math.max(settings.width || 0, settings.height || 0);
      let detectedLabel = '480P';
      if (actualW >= 3840) detectedLabel = '4K';
      else if (actualW >= 1920) detectedLabel = '1080P';
      else if (actualW >= 1280) detectedLabel = '720P';
      
      setActualResolution(detectedLabel);
      if (settings.frameRate) setActualFps(Math.round(settings.frameRate));
      
      // Smart detection: remove unsupported higher resolutions if fallback occurred
      if (res === '4K' && detectedLabel !== '4K') {
         setSupportedResolutions(prev => prev.filter(r => r !== '4K'));
         setResolution(detectedLabel);
      } else if (res === '1080P' && detectedLabel !== '1080P' && detectedLabel !== '4K') {
         setSupportedResolutions(prev => prev.filter(r => r !== '1080P' && r !== '4K'));
         setResolution(detectedLabel);
      }
      
      if (track.getCapabilities) {
        const caps = track.getCapabilities();
        setCapabilities(caps);
        if (caps.zoom && !zoom) {
           setZoom(caps.zoom.min || 1);
        }
        if (caps.exposureCompensation && exposure === 0) {
           setExposure(0);
        }
      }
      
      return stream;
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Camera error: ' + err.message + '\nTry refreshing or picking another lens.');
      setErrorMsg('Cannot access camera. Please allow permissions.');
      return null;
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
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    if (capabilities.zoom) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: newZoom }] });
      } catch (err) {}
    }
  };

  const handleExposureChange = async (e) => {
    const newExp = parseFloat(e.target.value);
    setExposure(newExp);
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    if (capabilities.exposureCompensation) {
      try {
        await track.applyConstraints({ advanced: [{ exposureCompensation: newExp }] });
      } catch (err) {}
    }
  };

  const toggleResolution = () => {
    let currentIndex = supportedResolutions.indexOf(resolution);
    if (currentIndex === -1) currentIndex = supportedResolutions.indexOf(actualResolution);
    
    const nextIndex = (currentIndex + 1) % supportedResolutions.length;
    const nextRes = supportedResolutions[nextIndex];
    setResolution(nextRes);
    
    const modeToUse = currentCameraId || facingMode;
    startCamera(modeToUse, nextRes).then(stream => {
      if (pcRef.current && stream) {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        const senders = pcRef.current.getSenders();
        
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) videoSender.replaceTrack(videoTrack);
        
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender) audioSender.replaceTrack(audioTrack);
      }
    });
  };

  const switchCameraTo = (deviceId, index) => {
    setCurrentCameraIndex(index);
    setShowCameraMenu(false);
    startCamera(deviceId).then(stream => {
      if (pcRef.current && stream) {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        const senders = pcRef.current.getSenders();
        
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) videoSender.replaceTrack(videoTrack);
        
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender) audioSender.replaceTrack(audioTrack);
      }
    });
  };

  const toggleCamera = () => {
    if (cameras.length > 1) {
      setShowCameraMenu(!showCameraMenu);
    } else {
      const newMode = facingMode === 'user' ? 'environment' : 'user';
      setFacingMode(newMode);
      startCamera(newMode).then(stream => {
        if (pcRef.current && stream) {
          const videoTrack = stream.getVideoTracks()[0];
          const audioTrack = stream.getAudioTracks()[0];
          const senders = pcRef.current.getSenders();
          
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) videoSender.replaceTrack(videoTrack);
          
          const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
          if (audioSender) audioSender.replaceTrack(audioTrack);
        }
      });
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

              <button className="ctrl-btn" onClick={toggleResolution}>
                <div className="res-badge">
                  <span>{actualResolution}</span>
                  <span className="fps-tag">{actualFps}</span>
                </div>
              </button>
            </div>

            <div className="cam-top-right">
              <button className="ctrl-btn">
                <Settings size={20} color="#fff" />
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

              {/* Teleprompter Overlay inside preview */}
              {showTeleprompterOverlay && teleprompter && teleprompter.isActive && (
                <div className="teleprompter-overlay">
                  <div className="teleprompter-header">
                    <span className="tp-name">{teleprompter.name}</span>
                    <span className="tp-counter">{teleprompter.currentIndex + 1} / {teleprompter.parts.length}</span>
                  </div>
                  <div className="teleprompter-content">
                    <p className="teleprompter-text">
                      {teleprompter.parts[teleprompter.currentIndex]}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sliders Section */}
          <div className="cam-sliders">
            <div className="slider-row">
              <span className="slider-label">Zoom</span>
              <input 
                type="range" 
                min={capabilities.zoom ? capabilities.zoom.min : 1} 
                max={capabilities.zoom ? capabilities.zoom.max : 5} 
                step={capabilities.zoom ? capabilities.zoom.step : 0.1} 
                value={zoom} 
                onChange={handleZoomChange}
                className="slider-track"
              />
              <span className="slider-value">{zoom.toFixed(1)}x</span>
            </div>

            {capabilities.exposureCompensation && (
              <div className="slider-row">
                <span className="slider-label">Bright</span>
                <input 
                  type="range" 
                  min={capabilities.exposureCompensation.min} 
                  max={capabilities.exposureCompensation.max} 
                  step={capabilities.exposureCompensation.step} 
                  value={exposure} 
                  onChange={handleExposureChange}
                  className="slider-track"
                />
                <span className="slider-value">{exposure > 0 ? '+' : ''}{exposure.toFixed(1)}</span>
              </div>
            )}
          </div>

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
