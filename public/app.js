// ========================================
// LiveKit Video Call - Client Application
// ========================================

// Get LiveKit from global scope (set by index.html)
const getLiveKit = () => {
  const sdk = window.LiveKitSDK || window.LivekitClient || window.Livekit || window.livekit;
  if (!sdk || !sdk.Room) {
    console.error('LiveKit SDK not available!');
    return null;
  }
  return sdk;
};

class VideoCallApp {
  constructor() {
    // LiveKit Room instance
    this.room = null;
    this.localParticipant = null;
    
    // State
    this.isMicEnabled = true;
    this.isCameraEnabled = true;
    this.isScreenSharing = false;
    this.callStartTime = null;
    this.timerInterval = null;
    
    // DOM Elements
    this.elements = {
      // Screens
      joinScreen: document.getElementById('join-screen'),
      callScreen: document.getElementById('call-screen'),
      
      // Join form
      joinForm: document.getElementById('join-form'),
      roomNameInput: document.getElementById('room-name'),
      participantNameInput: document.getElementById('participant-name'),
      joinBtn: document.getElementById('join-btn'),
      errorMessage: document.getElementById('error-message'),
      
      // Call screen
      roomDisplay: document.getElementById('room-display'),
      connectionStatus: document.getElementById('connection-status'),
      callTimer: document.getElementById('call-timer'),
      
      // Videos
      localVideo: document.getElementById('local-video'),
      remoteVideo: document.getElementById('remote-video'),
      localVideoWrapper: document.getElementById('local-video-wrapper'),
      remoteVideoWrapper: document.getElementById('remote-video-wrapper'),
      remotePlaceholder: document.getElementById('remote-placeholder'),
      localLabel: document.getElementById('local-label'),
      remoteLabel: document.getElementById('remote-label'),
      
      // Controls
      toggleMic: document.getElementById('toggle-mic'),
      toggleCamera: document.getElementById('toggle-camera'),
      toggleScreen: document.getElementById('toggle-screen'),
      endCall: document.getElementById('end-call'),
      volumeSlider: document.getElementById('volume-slider'),
      volumeDisplay: document.getElementById('volume-display'),
      speakerBoost: document.getElementById('speaker-boost'),
    };
    
    // Audio boost
    this.audioContext = null;
    this.gainNode = null;
    this.isBoostEnabled = false;
    
    this.init();
  }
  
  init() {
    // Bind event listeners
    this.elements.joinForm.addEventListener('submit', (e) => this.handleJoin(e));
    this.elements.toggleMic.addEventListener('click', () => this.toggleMicrophone());
    this.elements.toggleCamera.addEventListener('click', () => this.toggleCamera());
    this.elements.toggleScreen.addEventListener('click', () => this.toggleScreenShare());
    this.elements.endCall.addEventListener('click', () => this.handleEndCall());
    this.elements.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
    this.elements.speakerBoost.addEventListener('click', () => this.toggleSpeakerBoost());
    
    // Handle page unload
    window.addEventListener('beforeunload', () => this.cleanup());
    
    console.log('📹 Video Call App initialized');
  }
  
  // ========================================
  // Join Flow
  // ========================================
  
  async handleJoin(event) {
    event.preventDefault();
    
    const roomName = this.elements.roomNameInput.value.trim();
    const participantName = this.elements.participantNameInput.value.trim();
    
    if (!roomName || !participantName) {
      this.showError('Please fill in all fields');
      return;
    }
    
    this.setLoading(true);
    this.hideError();
    
    try {
      // Get token from server
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, participantName }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to get access token');
      }
      
      // Connect to LiveKit room
      await this.connectToRoom(data.wsUrl, data.token, roomName, participantName);
      
    } catch (error) {
      console.error('Join error:', error);
      this.showError(error.message);
      this.setLoading(false);
    }
  }
  
  async connectToRoom(wsUrl, token, roomName, participantName) {
    // Get LiveKit SDK
    this.LK = getLiveKit();
    if (!this.LK) {
      throw new Error('LiveKit SDK not loaded. Please refresh the page.');
    }
    
    try {
      // Create room instance
      this.room = new this.LK.Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720, frameRate: 30 },
        },
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        audioOutput: {
          volume: 1.0, // Max volume
        },
      });
      
      // Set up room event handlers
      this.setupRoomEvents();
      
      console.log('🔌 Connecting to LiveKit at:', wsUrl);
      
      // Connect to the room
      await this.room.connect(wsUrl, token);
      
      console.log('✅ Connected to room:', roomName);
      
      // Store local participant
      this.localParticipant = this.room.localParticipant;
      
      // Try to enable camera and microphone
      try {
        await this.localParticipant.enableCameraAndMicrophone();
        console.log('✅ Camera and microphone enabled');
      } catch (mediaError) {
        console.warn('⚠️ Could not enable camera/mic:', mediaError.message);
        // Try just microphone
        try {
          await this.localParticipant.setMicrophoneEnabled(true);
          console.log('✅ Microphone enabled (no camera)');
        } catch (micError) {
          console.warn('⚠️ Could not enable microphone:', micError.message);
        }
      }
      
      // Attach local video
      this.attachLocalVideo();
      
      // Switch to call screen
      this.showCallScreen(roomName, participantName);
      
      // Start timer
      this.startTimer();
      
    } catch (error) {
      console.error('Connection error:', error);
      // Show the actual error message for debugging
      let errorMessage = error.message || 'Unknown error';
      if (errorMessage.includes('WebSocket')) {
        errorMessage = 'Cannot connect to LiveKit server. Make sure Docker is running with: docker-compose up -d';
      } else if (errorMessage.includes('permission') || errorMessage.includes('NotAllowed')) {
        errorMessage = 'Camera/microphone access denied. Please allow access and try again.';
      }
      throw new Error(errorMessage);
    }
  }
  
  setupRoomEvents() {
    // Connection state changes
    this.room.on(this.LK.RoomEvent.ConnectionStateChanged, (state) => {
      console.log('Connection state:', state);
      this.updateConnectionStatus(state);
    });
    
    // When a new track is subscribed (remote participant's media)
    this.room.on(this.LK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log('Track subscribed:', track.kind, 'from', participant.identity);
      
      if (track.kind === 'video') {
        this.attachRemoteVideo(track, participant);
      } else if (track.kind === 'audio') {
        this.attachRemoteAudio(track);
      }
    });
    
    // When a track is unsubscribed
    this.room.on(this.LK.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log('Track unsubscribed:', track.kind);
      track.detach();
      
      if (track.kind === 'video') {
        this.showRemotePlaceholder();
      }
    });
    
    // When a participant connects
    this.room.on(this.LK.RoomEvent.ParticipantConnected, (participant) => {
      console.log('Participant connected:', participant.identity);
    });
    
    // When a participant disconnects
    this.room.on(this.LK.RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('Participant disconnected:', participant.identity);
      this.showRemotePlaceholder();
      this.elements.remoteLabel.textContent = 'Participant';
    });
    
    // When local track is published
    this.room.on(this.LK.RoomEvent.LocalTrackPublished, (publication, participant) => {
      console.log('Local track published:', publication.kind);
    });
    
    // Disconnected from room
    this.room.on(this.LK.RoomEvent.Disconnected, (reason) => {
      console.log('Disconnected from room:', reason);
      this.handleDisconnect();
    });
  }
  
  // ========================================
  // Video/Audio Handling
  // ========================================
  
  attachLocalVideo() {
    const videoTrack = this.localParticipant.getTrackPublication(this.LK.Track.Source.Camera);
    
    if (videoTrack && videoTrack.track) {
      videoTrack.track.attach(this.elements.localVideo);
    }
  }
  
  attachRemoteVideo(track, participant) {
    track.attach(this.elements.remoteVideo);
    this.elements.remotePlaceholder.classList.add('hidden');
    this.elements.remoteLabel.textContent = participant.identity;
  }
  
  attachRemoteAudio(track) {
    const audioElement = track.attach();
    
    // Set volume to maximum
    audioElement.volume = 1.0;
    
    // Ensure audio plays
    audioElement.autoplay = true;
    audioElement.playsInline = true;
    
    // Some browsers need user interaction - try to play
    audioElement.play().catch(e => {
      console.warn('Audio autoplay blocked, will play on user interaction');
    });
    
    // Store reference for volume control
    this.remoteAudioElement = audioElement;
    
    // Setup Web Audio API for volume boost
    this.setupAudioBoost(audioElement);
    
    document.body.appendChild(audioElement);
    console.log('🔊 Remote audio attached, volume:', audioElement.volume);
  }
  
  setupAudioBoost(audioElement) {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create source from audio element
      const source = this.audioContext.createMediaElementSource(audioElement);
      
      // Create gain node for volume boost
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0; // Normal volume
      
      // Connect: source -> gain -> output
      source.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
      
      console.log('🔊 Audio boost system initialized');
    } catch (error) {
      console.warn('Could not setup audio boost:', error);
    }
  }
  
  showRemotePlaceholder() {
    this.elements.remotePlaceholder.classList.remove('hidden');
    this.elements.remoteVideo.srcObject = null;
  }
  
  // ========================================
  // Control Handlers
  // ========================================
  
  async toggleMicrophone() {
    if (!this.localParticipant) return;
    
    try {
      this.isMicEnabled = !this.isMicEnabled;
      await this.localParticipant.setMicrophoneEnabled(this.isMicEnabled);
      this.elements.toggleMic.classList.toggle('muted', !this.isMicEnabled);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }
  
  async toggleCamera() {
    if (!this.localParticipant) return;
    
    try {
      this.isCameraEnabled = !this.isCameraEnabled;
      await this.localParticipant.setCameraEnabled(this.isCameraEnabled);
      this.elements.toggleCamera.classList.toggle('muted', !this.isCameraEnabled);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  }
  
  async toggleScreenShare() {
    if (!this.localParticipant) return;
    
    try {
      this.isScreenSharing = !this.isScreenSharing;
      await this.localParticipant.setScreenShareEnabled(this.isScreenSharing);
      this.elements.toggleScreen.classList.toggle('active', this.isScreenSharing);
    } catch (error) {
      console.error('Failed to toggle screen share:', error);
      this.isScreenSharing = false;
      this.elements.toggleScreen.classList.remove('active');
    }
  }
  
  async handleEndCall() {
    await this.cleanup();
    this.showJoinScreen();
  }
  
  setVolume(value) {
    const volumePercent = parseInt(value);
    
    // Update display
    this.elements.volumeDisplay.textContent = volumePercent + '%';
    this.elements.volumeDisplay.classList.toggle('boosted', volumePercent > 100);
    
    if (this.gainNode) {
      // Use gain node for amplification (can go above 100%)
      this.gainNode.gain.value = volumePercent / 100;
      console.log('🔊 Volume set to:', volumePercent + '%');
    } else if (this.remoteAudioElement) {
      // Fallback to regular volume (max 100%)
      this.remoteAudioElement.volume = Math.min(volumePercent / 100, 1);
    }
  }
  
  toggleSpeakerBoost() {
    this.isBoostEnabled = !this.isBoostEnabled;
    
    if (this.isBoostEnabled) {
      // Set volume to 200%
      this.elements.volumeSlider.value = 200;
      this.setVolume(200);
      this.elements.speakerBoost.classList.add('boost-active');
      console.log('🔊 Speaker BOOST enabled!');
    } else {
      // Reset to 100%
      this.elements.volumeSlider.value = 100;
      this.setVolume(100);
      this.elements.speakerBoost.classList.remove('boost-active');
      console.log('🔊 Speaker boost disabled');
    }
  }
  
  // ========================================
  // UI Updates
  // ========================================
  
  showCallScreen(roomName, participantName) {
    this.elements.joinScreen.classList.remove('active');
    this.elements.callScreen.classList.add('active');
    this.elements.roomDisplay.textContent = roomName;
    this.elements.localLabel.textContent = participantName;
    this.setLoading(false);
  }
  
  showJoinScreen() {
    this.elements.callScreen.classList.remove('active');
    this.elements.joinScreen.classList.add('active');
    this.stopTimer();
    
    // Reset states
    this.isMicEnabled = true;
    this.isCameraEnabled = true;
    this.isScreenSharing = false;
    this.elements.toggleMic.classList.remove('muted');
    this.elements.toggleCamera.classList.remove('muted');
    this.elements.toggleScreen.classList.remove('active');
    this.showRemotePlaceholder();
  }
  
  updateConnectionStatus(state) {
    const statusEl = this.elements.connectionStatus;
    const statusText = statusEl.querySelector('span:last-child') || statusEl;
    
    switch (state) {
      case 'connected':
        statusEl.classList.add('connected');
        statusText.textContent = 'Connected';
        break;
      case 'connecting':
        statusEl.classList.remove('connected');
        statusText.textContent = 'Connecting...';
        break;
      case 'reconnecting':
        statusEl.classList.remove('connected');
        statusText.textContent = 'Reconnecting...';
        break;
      default:
        statusEl.classList.remove('connected');
        statusText.textContent = state;
    }
  }
  
  setLoading(loading) {
    this.elements.joinBtn.disabled = loading;
    this.elements.joinBtn.classList.toggle('loading', loading);
  }
  
  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.elements.errorMessage.classList.remove('hidden');
  }
  
  hideError() {
    this.elements.errorMessage.classList.add('hidden');
  }
  
  // ========================================
  // Timer
  // ========================================
  
  startTimer() {
    this.callStartTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.callStartTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      this.elements.callTimer.textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }
  
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.elements.callTimer.textContent = '00:00';
  }
  
  // ========================================
  // Cleanup
  // ========================================
  
  async cleanup() {
    // Notify server
    const roomName = this.elements.roomNameInput.value.trim();
    const participantName = this.elements.participantNameInput.value.trim();
    
    if (roomName && participantName) {
      try {
        await fetch('/api/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName, participantName }),
        });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    // Disconnect from room
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    
    this.localParticipant = null;
    this.stopTimer();
  }
  
  handleDisconnect() {
    this.showJoinScreen();
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  new VideoCallApp();
});

