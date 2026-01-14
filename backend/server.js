const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

// ✅ Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();

// ✅ In-memory Job Store (For real-time progress)
const jobs = {};

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Health Check Route
app.get("/", (req, res) => {
  res.json({ status: "success", message: "ML Training Backend is Running!" });
});

// ✅ Test POST Route (For debugging SSL/Network issues)
app.post("/api/test-post", (req, res) => {
  res.json({ status: "success", message: "POST connection working!" });
});

// ✅ Status Polling API
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) {
    return res.status(404).json({ status: "error", message: "Job not found" });
  }
  res.json(job);
});

// ✅ Ensure uploads folder exists
const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// ✅ Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, file.originalname),
});

const upload = multer({ storage });

// ✅ Upload API
app.post(
  "/api/upload",
  upload.fields([{ name: "csv", maxCount: 1 }]),
  async (req, res) => {
    const jobId = uuidv4();
    try {
      // ✅ Validation
      if (!req.files?.csv) {
        return res.status(400).json({ message: "CSV file is required" });
      }

      const csvPath = req.files.csv[0].path;
      const email = req.body.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Initialize Job
      jobs[jobId] = {
        id: jobId,
        status: "uploading",
        progress: 10,
        email,
      };

      console.log("CSV uploaded:", csvPath);
      console.log("Email:", email);

      // ✅ Upload CSV to Supabase
      const csvBuffer = fs.readFileSync(csvPath);
      const csvFileName = path.basename(csvPath);

      const { data: csvData, error: csvError } = await supabase.storage
        .from("ml-datasets")
        .upload(`uploads/${Date.now()}_${csvFileName}`, csvBuffer, {
          contentType: "text/csv",
        });

      if (csvError) {
        console.error("Supabase storage error details:", JSON.stringify(csvError, null, 2));
        throw new Error(`Supabase upload failed: ${csvError.message || "Unknown error"}`);
      }

      const {
        data: { publicUrl: csvUrl },
      } = supabase.storage.from("ml-datasets").getPublicUrl(csvData.path);

      console.log("CSV Public URL:", csvUrl);
      jobs[jobId].status = "training";
      jobs[jobId].progress = 40;

      // ✅ Delete local file (important on Render)
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);

      // ✅ Trigger n8n Workflow (PRODUCTION MODE)
      const n8nUploadUrl = process.env.N8N_UPLOAD_WEBHOOK || "https://n8n-1-wpup.onrender.com/webhook/ml-upload";
      const n8nCallbackUrl = process.env.N8N_CALLBACK_URL || "https://auto-ml-train-1.onrender.com/api/callback";

      console.log("Triggering n8n at:", n8nUploadUrl);
      const n8nRes = await axios.post(
        n8nUploadUrl,
        {
          csvUrl,
          email,
          jobId, // Pass jobId to n8n
          callback_url: n8nCallbackUrl,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        }
      );

      console.log("n8n workflow triggered successfully. Response status:", n8nRes.status);

      res.json({
        status: "success",
        message: "CSV uploaded & ML training started",
        jobId,
      });
    } catch (error) {
      const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
      console.error("Upload error detail:", errorDetail);

      if (jobs[jobId]) {
        jobs[jobId].status = "error";
        jobs[jobId].message = error.message;
      }

      res.status(500).json({
        status: "error",
        message: `Upload process failed: ${error.message}`,
        detail: error.response?.data || null
      });
    }
  }
);

// ✅ Callback API (Receive results from n8n)
app.post("/api/callback", async (req, res) => {
  try {
    console.log("Callback received from n8n:", req.body);
    const { jobId, status, display_metric, message } = req.body;

    if (jobId && jobs[jobId]) {
      jobs[jobId].status = status || "completed";
      jobs[jobId].progress = 100;
      jobs[jobId].result = { display_metric, message };
    }

    res.json({ status: "success", message: "Callback processed" });
  } catch (error) {
    console.error("Callback error:", error.message);
    res.status(500).json({ status: "error", message: "Failed to process callback" });
  }
});

// ✅ Start server (Render-compatible)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
