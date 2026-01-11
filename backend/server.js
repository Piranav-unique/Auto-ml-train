const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// ✅ Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Health Check Route
app.get("/", (req, res) => {
  res.json({ status: "success", message: "ML Training Backend is Running!" });
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

      // ✅ Delete local file (important on Render)
      fs.unlinkSync(csvPath);

      // ✅ Trigger n8n Workflow 1 (START TRAINING)
      const n8nUploadUrl = process.env.N8N_UPLOAD_WEBHOOK || "https://n8n-1-wpup.onrender.com/webhook/ml-upload";
      const n8nCallbackUrl = process.env.N8N_CALLBACK_URL || "https://auto-ml-train.onrender.com/api/callback";

      await axios.post(
        n8nUploadUrl,
        {
          csvUrl,
          email,
          callback_url: n8nCallbackUrl,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        }
      );

      console.log("n8n workflow triggered successfully");

      res.json({
        status: "success",
        message: "CSV uploaded & ML training started",
        csvUrl,
        email,
      });
    } catch (error) {
      console.error("Upload error:", error.message);
      res.status(500).json({
        status: "error",
        message: "Server error during upload",
      });
    }
  }
);

// ✅ Callback API (Receive results from n8n)
app.post("/api/callback", async (req, res) => {
  try {
    console.log("Callback received from n8n:", req.body);
    // You can add logic here to save results to Supabase or notify the user
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
