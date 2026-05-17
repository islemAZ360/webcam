import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB7RbQFsU1C-O-hyZX3V8vSIriQC7_wPpI",
  authDomain: "webcam-15d71.firebaseapp.com",
  projectId: "webcam-15d71",
  storageBucket: "webcam-15d71.firebasestorage.app",
  messagingSenderId: "1065030253514",
  appId: "1:1065030253514:web:8e78d12bfb823a043bad33",
  measurementId: "G-H1Z3WGZZFV"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
