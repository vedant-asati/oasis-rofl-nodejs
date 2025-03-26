const express = require('express');
const cors = require('cors');
const http = require('http');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(bodyParser.json());

// Environment variables for configuration
const CONTRACT_ADDRESS = "0xf4630778eF83230A0081fb45b241Ff826766ffF8";
if (!CONTRACT_ADDRESS) {
  console.error("CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}

// Queue for storing observations to be submitted
let pendingObservations = [];
let historicalObservations = [];

// Submit an observation to the blockchain
async function submitObservationToBlockchain(value) {
  try {
    // Format calldata for submitObservation(uint128)
    const method = "dae1ee1f"; // Keccak4("submitObservation(uint128)")
    const valueHex = BigInt(value).toString(16).padStart(64, '0');
    const data = `0x${method}${valueHex}`;

    // Create request options for ROFL socket
    const options = {
      socketPath: '/run/rofl-appd.sock',
      path: '/rofl/v1/tx/sign-submit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    };

    // Create request body
    const requestBody = JSON.stringify({
      tx: {
        kind: "eth",
        data: {
          gas_limit: 200000,
          to: CONTRACT_ADDRESS,
          value: 0,
          data: data
        }
      }
    });

    // Send request through ROFL socket
    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log(`Submitted observation: ${value}, response:`, data);
          resolve(data);
        });
      });

      req.on('error', (error) => {
        console.error(`Error submitting observation: ${error.message}`);
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  } catch (error) {
    console.error("Error in submitObservationToBlockchain:", error);
    throw error;
  }
}

// Get the last observation from the blockchain
async function getLastObservationFromBlockchain() {
  try {
    // Format calldata for getLastObservation()
    const method = "8c385474"; // Keccak4("getLastObservation()")
    const data = `0x${method}`;

    // Create request options for ROFL socket
    const options = {
      socketPath: '/run/rofl-appd.sock',
      path: '/rofl/v1/tx/call',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    };

    // Create request body
    const requestBody = JSON.stringify({
      tx: {
        kind: "eth",
        data: {
          to: CONTRACT_ADDRESS,
          data: data
        }
      }
    });

    // Send request through ROFL socket
    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.result) {
              // Decode the response - this is a simplified version
              // In production, use proper ABI decoding
              const result = response.result.slice(2); // Remove '0x'
              const value = parseInt(result.slice(0, 64), 16);
              const block = parseInt(result.slice(64, 128), 16);
              resolve({ value, block });
            } else {
              reject(new Error("No result in response"));
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`Error getting last observation: ${error.message}`);
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  } catch (error) {
    console.error("Error in getLastObservationFromBlockchain:", error);
    throw error;
  }
}

// Process pending observations periodically
setInterval(async () => {
  if (pendingObservations.length > 0) {
    console.log(`Processing ${pendingObservations.length} pending observations`);
    const observation = pendingObservations.shift();
    try {
      await submitObservationToBlockchain(observation);
      historicalObservations.push(observation);
    } catch (error) {
      console.error(`Failed to submit observation, re-queueing: ${observation}`);
      pendingObservations.unshift(observation);
    }
  }
}, 30000); // Process every 30 seconds

// API Endpoints
app.get('/', (req, res) => {
  res.status(200).json({ status: 'JSR! Hi there!' });
});

app.post('/api/submit', (req, res) => {
  const { value } = req.body;

  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'Value is required' });
  }

  // Add to pending queue
  pendingObservations.push(Number(value));

  console.log(`Queued observation: ${value}, queue length: ${pendingObservations.length}`);

  return res.status(200).json({
    message: 'Observation queued for submission',
    queueLength: pendingObservations.length
  });
});

app.get('/api/last-observation-local', async (req, res) => {
  try {
    const observation = historicalObservations[historicalObservations.length - 1];
    return res.status(200).json(observation);
  } catch (error) {
    console.error("Error getting last local observation:", error);
    return res.status(500).json({ error: 'Failed to get last local observation' });
  }
});

app.get('/api/last-observation', async (req, res) => {
  try {
    const observation = await getLastObservationFromBlockchain();
    return res.status(200).json(observation);
  } catch (error) {
    console.error("Error getting last observation:", error);
    return res.status(500).json({ error: 'Failed to get last observation' });
  }
});

app.get('/api/delete', (req, res) => {
  try {
    const observation = pendingObservations.pop();
    return res.status(200).json(observation);
  } catch (error) {
    console.error("Error deleting last queued observation:", error);
    return res.status(500).json({ error: 'Failed to get last queued observation' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`ROFL app listening on port ${PORT}`);
});
