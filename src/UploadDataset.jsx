import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

function UploadDataset() {
    const [csv, setCsv] = useState(null);
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState("idle"); // idle, uploading, training, completed, error
    const [progress, setProgress] = useState(0);
    const [jobId, setJobId] = useState(null);
    const [result, setResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState("");

    // Polling logic
    useEffect(() => {
        let interval;
        if (status === "training" && jobId) {
            interval = setInterval(async () => {
                try {
                    const res = await axios.get(`${API_BASE_URL}/api/status/${jobId}`);
                    const job = res.data;

                    if (job.status === "completed") {
                        setStatus("completed");
                        setProgress(100);
                        setResult(job.result);
                        clearInterval(interval);
                    } else if (job.status === "error") {
                        setStatus("error");
                        setErrorMsg("Cloud training failed. Please check your data.");
                        clearInterval(interval);
                    } else {
                        // Smoothly increment progress
                        setProgress(prev => Math.min(prev + 2, 95));
                    }
                } catch (err) {
                    console.error("Polling error:", err);
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [status, jobId]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith(".csv")) {
            setCsv(file);
            setErrorMsg("");
        } else {
            alert("Please upload a valid CSV file");
            e.target.value = null;
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!csv || !email) return;

        setStatus("uploading");
        setProgress(10);
        setErrorMsg("");
        setResult(null);

        const formData = new FormData();
        formData.append("csv", csv);
        formData.append("email", email);

        try {
            const res = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
                headers: { "Content-Type": "multipart/form-data" }
            });

            setJobId(res.data.jobId);
            setStatus("training");
            setProgress(30);
        } catch (err) {
            setStatus("error");
            setErrorMsg(err.response?.data?.message || err.message);
        }
    };

    return (
        <div className="container">
            <div className="card">
                <h1>AI Model Studio</h1>
                <p className="subtitle">Upload your dataset and train high-precision XGBoost models in seconds.</p>

                {status === "idle" || status === "error" ? (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Email Address</label>
                            <input
                                type="email"
                                placeholder="name@example.com"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>

                        <div className="form-group">
                            <label>Dataset (CSV)</label>
                            <input
                                type="file"
                                accept=".csv"
                                required
                                onChange={handleFileChange}
                            />
                        </div>

                        <button type="submit" disabled={!csv || !email}>
                            {status === "error" ? "Try Again" : "Start Training"}
                        </button>

                        {status === "error" && <p className="error-msg">❌ {errorMsg}</p>}
                    </form>
                ) : (
                    <div className="status-container">
                        <div className="status-text">
                            <div className="pulse"></div>
                            {status === "uploading" ? "Uploading Stream..." :
                                status === "training" ? "Processing on Cloud GPU..." :
                                    "Training Complete!"}
                        </div>

                        <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                        </div>

                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                            {status === "uploading" ? "Syncing data to Supabase..." :
                                status === "training" ? "XGBoost is finding hidden patterns..." :
                                    "All done! View your results below."}
                        </p>
                    </div>
                )}

                {status === "completed" && result && (
                    <div className="result-card">
                        <div className="result-header">
                            <div className="success-icon">✓</div>
                            <h2 className="result-title">Training Complete!</h2>
                            <p className="result-subtitle">Your ML model has been successfully trained</p>
                        </div>

                        <div className="metric-showcase">
                            <div className="metric-badge">
                                <span className="metric-label">Model Performance</span>
                                <span className="metric-value">{result.display_metric}</span>
                            </div>
                        </div>

                        <div className="result-details">
                            <div className="detail-item">
                                <span className="detail-icon">📊</span>
                                <div className="detail-content">
                                    <p className="detail-label">Algorithm</p>
                                    <p className="detail-value">XGBoost (Gradient Boosting)</p>
                                </div>
                            </div>
                            <div className="detail-item">
                                <span className="detail-icon">⚡</span>
                                <div className="detail-content">
                                    <p className="detail-label">Status</p>
                                    <p className="detail-value">Ready for Production</p>
                                </div>
                            </div>
                            <div className="detail-item">
                                <span className="detail-icon">📧</span>
                                <div className="detail-content">
                                    <p className="detail-label">Email Report</p>
                                    <p className="detail-value">Sent to {email}</p>
                                </div>
                            </div>
                        </div>

                        <div className="result-message">
                            <p>{result.message}</p>
                        </div>

                        <button
                            onClick={() => {
                                setStatus("idle");
                                setCsv(null);
                                setEmail("");
                                setResult(null);
                                setProgress(0);
                            }}
                            className="train-another-btn"
                        >
                            Train Another Model
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default UploadDataset;
