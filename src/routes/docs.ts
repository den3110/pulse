import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();
const DOCS_DIR = path.join(__dirname, "../../docs");

// Get documentation menu
router.get("/menu", (req, res) => {
  try {
    const menuPath = path.join(DOCS_DIR, "menu.json");
    if (!fs.existsSync(menuPath)) {
      return res.status(404).json({ error: "Menu configuration not found." });
    }
    const menuData = fs.readFileSync(menuPath, "utf8");
    res.json(JSON.parse(menuData));
  } catch (error) {
    console.error("Error fetching docs menu:", error);
    res
      .status(500)
      .json({ error: "Internal server error while fetching menu." });
  }
});

// Get documentation content by ID
router.get("/content/:id", (req, res) => {
  try {
    const { id } = req.params;

    // Basic sanitization
    if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
      return res.status(400).json({ error: "Invalid document ID." });
    }

    const docPath = path.join(DOCS_DIR, `${id}.md`);
    if (!fs.existsSync(docPath)) {
      // Return a temporary placeholder for missing docs instead of 404 to avoid frontend crash on missing draft
      return res.send(
        `# Under Construction 🚧\n\nThis page (${id}) is currently being written. Please check back later!`,
      );
    }

    const content = fs.readFileSync(docPath, "utf8");

    // Set headers for markdown
    res.setHeader("Content-Type", "text/markdown");
    res.send(content);
  } catch (error) {
    console.error(`Error fetching docs content ${req.params.id}:`, error);
    res
      .status(500)
      .json({
        error: "Internal server error while fetching document content.",
      });
  }
});

export default router;
