import { useState, useRef, useEffect } from 'react';
import { Camera, Video, VideoOff, SwitchCamera } from 'lucide-react';
import { db } from './firebase';
import { collection, doc, getDoc, setDoc, updateDoc, onSnapshot, addDoc } from 'firebase/firestore';
import './index.css';

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

function App() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, connected, error
  const [errorMsg, setErrorMsg] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState('user'); // user or environment
  const localVideoRef = useRef(null);
  
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomRef = useRef(null);

  // Initialize camera
  const startCamera = async (mode = facingMode) => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
      return stream;
    } catch (err) {
      console.error('Error accessing camera:', err);
      setErrorMsg('Cannot access camera. Please allow permissions.');
      return null;
    }
  };

  const toggleCamera = () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    startCamera(newMode).then(stream => {
      // If we are already connected, we need to replace the tracks
      if (pcRef.current && stream) {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        const senders = pcRef.current.getSenders();
        
        const videoSender = senders.find(s => s.track.kind === 'video');
        if (videoSender) videoSender.replaceTrack(videoTrack);
        
        const audioSender = senders.find(s => s.track.kind === 'audio');
        if (audioSender) audioSender.replaceTrack(audioTrack);
      }
    });
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
      const stream = await startCamera();
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

      // 5. Listen for remote answer
      onSnapshot(roomDocument, (snapshot) => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
          const answerDescription = new RTCSessionDescription(data.answer);
          pc.setRemoteDescription(answerDescription);
          setStatus('connected');
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

      {!isCameraActive ? (
        <div className="glass-card">
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
      ) : (
        <div className="video-container">
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)' }}
          />
          <div className="controls">
            <button className="icon-btn" onClick={toggleCamera} title="Switch Camera">
              <SwitchCamera size={24} color="white" />
            </button>
            <button className="icon-btn danger" onClick={stopConnection} title="Stop Stream">
              <VideoOff size={24} color="white" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
