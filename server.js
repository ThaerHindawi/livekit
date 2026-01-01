require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// LiveKit credentials from environment
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms (in production, use Redis or a database)
const activeRooms = new Map();

// Generate access token for a participant
app.post('/api/token', async (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({ 
        error: 'roomName and participantName are required' 
      });
    }

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(500).json({ 
        error: 'LiveKit credentials not configured. Please check your .env file.' 
      });
    }

    // Check room capacity (max 2 for 1-to-1)
    if (!activeRooms.has(roomName)) {
      activeRooms.set(roomName, new Set());
    }
    
    const roomParticipants = activeRooms.get(roomName);
    
    if (roomParticipants.size >= 2 && !roomParticipants.has(participantName)) {
      return res.status(403).json({ 
        error: 'Room is full. Maximum 2 participants allowed for 1-to-1 calls.' 
      });
    }

    // Create access token
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantName,
      ttl: '2h', // Token valid for 2 hours
    });

    // Grant permissions
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    // Track participant
    roomParticipants.add(participantName);

    res.json({ 
      token: jwt,
      wsUrl: LIVEKIT_WS_URL,
      roomName,
      participantName
    });

  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Remove participant from room tracking
app.post('/api/leave', (req, res) => {
  const { roomName, participantName } = req.body;
  
  if (activeRooms.has(roomName)) {
    activeRooms.get(roomName).delete(participantName);
    
    // Clean up empty rooms
    if (activeRooms.get(roomName).size === 0) {
      activeRooms.delete(roomName);
    }
  }
  
  res.json({ success: true });
});

// Get room status
app.get('/api/room/:roomName', (req, res) => {
  const { roomName } = req.params;
  const participants = activeRooms.get(roomName);
  
  res.json({
    roomName,
    participantCount: participants ? participants.size : 0,
    isFull: participants ? participants.size >= 2 : false
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    configured: !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_WS_URL)
  });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Video Call Server running on http://localhost:${PORT}`);
  console.log(`📹 LiveKit configured: ${!!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET)}`);
});

