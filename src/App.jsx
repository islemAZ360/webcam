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
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: true
      });
      
      localStreamRef.current = stream;
      setLocalStream(stream);
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
      <div className="status-badge" style={{ position: 'absolute', top: '2rem', left: '2rem' }}>
        <div className={`dot ${status}`}></div>
        {status === 'disconnected' ? 'Disconnected' : 
         status === 'connecting' ? 'Connecting...' : 
         status === 'connected' ? 'Connected' : 'Error'}
      </div>

      <div className="glass-card" style={{ display: !isCameraActive ? 'flex' : 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <div style={{ background: 'rgba(99, 102, 241, 0.2)', padding: '1rem', borderRadius: '50%' }}>
            <Camera size={40} color="var(--primary)" />
          </div>
        </div>
        <h1>Connect to PC</h1>
        <p>Enter the 6-digit code shown on your computer screen to start streaming.</p>
        
        {errorMsg && (
          <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem' }}>
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

      <div className="video-container" style={{ display: isCameraActive ? 'block' : 'none' }}>
        <video 
          ref={localVideoRef} 
          autoPlay 
          playsInline 
          muted 
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)' }}
        />
        
        {/* Top Native Bar */}
        <div className="native-top-bar">

          <button className="icon-btn-transparent" onClick={toggleTorch} style={{ opacity: capabilities.torch ? 1 : 0.3 }} disabled={!capabilities.torch}>
            {torchOn ? <Zap size={24} color="#fff" fill="#fff" /> : <ZapOff size={24} color="#fff" />}
          </button>
          {teleprompter && teleprompter.isActive ? (
            <button 
              className="icon-btn-transparent" 
              onClick={() => setShowTeleprompterOverlay(!showTeleprompterOverlay)}
              style={{ background: showTeleprompterOverlay ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.2)' }}
            >
              <FileText size={24} color="#3b82f6" />
            </button>
          ) : (
            <button className="icon-btn-transparent" style={{ opacity: 0.3 }} disabled>
              <FileText size={24} color="#fff" />
            </button>
          )}
          <button className="icon-btn-transparent" onClick={toggleResolution}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontWeight: 'bold', fontSize: '0.7rem', color: '#fff' }}>
              <span>{actualResolution}</span>
              <span style={{ background: '#fff', color: '#000', padding: '1px 4px', borderRadius: '4px', marginTop: '2px' }}>{actualFps}</span>
            </div>
          </button>
          <button className="icon-btn-transparent">
            <Settings size={24} color="#fff" />
          </button>
        </div>

        {/* Zoom Slider */}
        <div className="native-slider-container zoom-slider">
          <div style={{ color: '#fff', fontSize: '0.8rem', marginBottom: '0.5rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Zoom</div>
          <div className="slider-wrapper">
            <span style={{ color: '#fff', fontSize: '0.8rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>1x</span>
            <input 
              type="range" 
              min={capabilities.zoom ? capabilities.zoom.min : 1} 
              max={capabilities.zoom ? capabilities.zoom.max : 5} 
              step={capabilities.zoom ? capabilities.zoom.step : 0.1} 
              value={zoom} 
              onChange={handleZoomChange}
              className="native-slider"
            />
            <span style={{ color: '#fff', fontSize: '0.8rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Max</span>
          </div>
          <div style={{ color: '#facc15', fontSize: '1.2rem', marginTop: '0.5rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            {zoom.toFixed(1)}x
          </div>
        </div>

        {/* Exposure/Brightness Slider */}
        {capabilities.exposureCompensation && (
          <div className="native-slider-container exposure-slider">
            <div style={{ color: '#fff', fontSize: '0.8rem', marginBottom: '0.5rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Bright</div>
            <div className="slider-wrapper">
              <span style={{ color: '#fff', fontSize: '0.8rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>-</span>
              <input 
                type="range" 
                min={capabilities.exposureCompensation.min} 
                max={capabilities.exposureCompensation.max} 
                step={capabilities.exposureCompensation.step} 
                value={exposure} 
                onChange={handleExposureChange}
                className="native-slider"
              />
              <span style={{ color: '#fff', fontSize: '0.8rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>+</span>
            </div>
            <div style={{ color: '#facc15', fontSize: '1.2rem', marginTop: '0.5rem', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
              {exposure > 0 ? '+' : ''}{exposure.toFixed(1)}
            </div>
          </div>
        )}

        {/* Bottom Native Bar */}
        <div className="native-bottom-bar">
          <div className="gallery-thumbnail" style={{ opacity: status === 'connected' ? 1 : 0.3 }} title={status}>
             <Monitor size={20} color="#fff" />
          </div>
          
          <button className="record-btn" onClick={stopConnection} title="Stop Camera">
            <div className="record-btn-inner"></div>
          </button>

          <div style={{ position: 'relative' }}>
            {/* Camera Selection Menu */}
            {showCameraMenu && cameras.length > 1 && (
              <div style={{
                position: 'absolute', bottom: '100%', right: '0', marginBottom: '1rem',
                background: 'rgba(15, 23, 42, 0.95)', padding: '0.5rem',
                borderRadius: '1rem', border: '1px solid #3b82f6',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
                minWidth: '220px', backdropFilter: 'blur(10px)', zIndex: 100
              }}>
                <div style={{ color: '#fff', fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>Select Camera Lens</div>
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
                      onClick={() => switchCameraTo(cam.deviceId, idx)}
                      style={{
                        background: currentCameraId === cam.deviceId ? '#3b82f6' : 'transparent',
                        color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem',
                        textAlign: 'left', fontSize: '0.9rem', width: '100%', cursor: 'pointer'
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            
            <button className="flip-btn" onClick={toggleCamera}>
              <SwitchCamera size={28} color="#fff" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Teleprompter Overlay */}
      {showTeleprompterOverlay && teleprompter && teleprompter.isActive && (
        <div className="teleprompter-overlay">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{teleprompter.name}</span>
            <span style={{ color: '#94a3b8' }}>{teleprompter.currentIndex + 1} / {teleprompter.parts.length}</span>
          </div>
          <div className="teleprompter-content">
            <p className="teleprompter-text">
              {teleprompter.parts[teleprompter.currentIndex]}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
