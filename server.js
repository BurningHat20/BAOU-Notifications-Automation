import { config as dotenvConfig } from "dotenv";
import { Resend } from "resend";
import axios from "axios";
import * as cheerio from "cheerio";
import { writeFile, readFile } from "fs/promises";

// Load environment variables
dotenvConfig();

// Initialize configuration
const CONFIG = {
  url: "http://assignment.baou.edu.in/Dp_assignment/check_home.aspx",
  checkInterval: 1800000, // 30 minutes
  storageFile: "previous-notifications.json",
  email: {
    from: "BAOU Notifications <onboarding@resend.dev>",
    to: process.env.EMAIL_TO,
    replyTo: "no-reply@yourdomain.com",
  },
  design: {
    colors: {
      primary: "#1a73e8",
      secondary: "#f8f9fa",
      accent: "#fbbc04",
      text: "#202124",
      lightText: "#5f6368",
      danger: "#ea4335",
      success: "#34a853",
      warning: "#fbbc04",
    },
    fonts: {
      primary:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
    },
  },
};

// Validate environment variables
const requiredEnvVars = ["RESEND_API_KEY", "EMAIL_TO"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize email client
const resend = new Resend(process.env.RESEND_API_KEY);

// Utility Functions
function formatDate(date) {
  return new Date(date).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function detectUrgency(text) {
  const urgentKeywords = [
    "urgent",
    "immediate",
    "important",
    "deadline",
    "today",
    "tomorrow",
    "asap",
    "emergency",
    "critical",
    "required",
    "mandatory",
    "due",
    "અગત્યની",
    "તાકીદની",
  ];
  return urgentKeywords.some((keyword) =>
    text.toLowerCase().includes(keyword.toLowerCase())
  );
}

function categorizeNotification(text) {
  const categories = {
    EXAM: ["exam", "examination", "test", "assessment", "પરીક્ષા"],
    ASSIGNMENT: ["assignment", "homework", "submission", "સ્વાધ્યાય"],
    SCHEDULE: ["schedule", "timetable", "dates", "સમયપત્રક"],
    ANNOUNCEMENT: ["announcement", "notice", "circular", "સૂચના"],
    DEADLINE: ["last date", "deadline", "due date", "અંતિમ તારીખ"],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (
      keywords.some((keyword) =>
        text.toLowerCase().includes(keyword.toLowerCase())
      )
    ) {
      return category;
    }
  }
  return "OTHER";
}

function generateNotificationId(text, timestamp) {
  return Buffer.from(`${text}-${timestamp}`).toString("base64").slice(0, 12);
}

function detectLanguage(text) {
  const gujaratiRegex = /[\u0A80-\u0AFF]/;
  return gujaratiRegex.test(text) ? "gujarati" : "english";
}

function calculatePriority(notification) {
  let score = 0;

  if (notification.isUrgent) score += 2;
  if (notification.isNew) score += 1;
  if (notification.category === "DEADLINE") score += 1;
  if (notification.text.toLowerCase().includes("important")) score += 1;

  return Math.min(5, score);
}

// HTML Email Template Generator
function generateEmailHTML(notifications, stats) {
  const emailCSS = `
    .notification-email {
      font-family: ${CONFIG.design.fonts.primary};
      line-height: 1.6;
      color: ${CONFIG.design.colors.text};
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: ${CONFIG.design.colors.primary};
      color: white;
      padding: 24px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .content {
      padding: 24px;
      background: white;
    }
    .notification-card {
      background: ${CONFIG.design.colors.secondary};
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      border-left: 4px solid ${CONFIG.design.colors.primary};
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .notification-meta {
      color: ${CONFIG.design.colors.lightText};
      font-size: 0.9em;
      margin-top: 8px;
    }
    .tag {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.8em;
      margin-right: 8px;
      font-weight: 500;
    }
    .tag-new {
      background: ${CONFIG.design.colors.success};
      color: white;
    }
    .tag-urgent {
      background: ${CONFIG.design.colors.danger};
      color: white;
    }
    .priority-high {
      border-left-color: ${CONFIG.design.colors.danger};
    }
    .footer {
      text-align: center;
      padding: 24px;
      color: ${CONFIG.design.colors.lightText};
      font-size: 0.9em;
      border-top: 1px solid ${CONFIG.design.colors.secondary};
    }
  `;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>BAOU Notifications</title>
        <style>${emailCSS}</style>
      </head>
      <body>
        <div class="notification-email">
          <div class="header">
            <h1 style="margin: 0;">BAOU Notifications</h1>
            <p style="margin: 8px 0 0 0;">${formatDate(new Date())}</p>
          </div>
          
          <div class="content">
            <h2 style="margin: 0 0 16px;">New Notifications</h2>
            ${notifications
              .map(
                (notification) => `
              <div class="notification-card ${
                notification.isUrgent ? "priority-high" : ""
              }">
                <div style="margin-bottom: 8px;">
                  ${
                    notification.isNew
                      ? '<span class="tag tag-new">New</span>'
                      : ""
                  }
                  ${
                    notification.isUrgent
                      ? '<span class="tag tag-urgent">Urgent</span>'
                      : ""
                  }
                  <span class="tag" style="background: ${
                    CONFIG.design.colors.accent
                  }">${notification.category}</span>
                  ${
                    detectLanguage(notification.text) === "gujarati"
                      ? '<span class="tag" style="background: #4A90E2;">ગુજરાતી</span>'
                      : ""
                  }
                </div>
                <div style="font-size: 1.1em;">
                  ${
                    notification.link
                      ? `<a href="${notification.link}" style="color: ${CONFIG.design.colors.primary}; text-decoration: underline;">
                      ${notification.text}
                    </a>`
                      : notification.text
                  }
                </div>
                <div class="notification-meta">
                  <div>Posted: ${formatDate(notification.timestamp)}</div>
                </div>
              </div>
            `
              )
              .join("")}
          </div>

          <div class="footer">
            <p>BAOU Notification Monitoring System</p>
            <p style="margin: 4px 0;">Last checked: ${formatDate(
              new Date()
            )}</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

// Core Functions
async function fetchNotifications() {
  try {
    const response = await axios.get(CONFIG.url, {
      timeout: 10000,
      headers: {
        "User-Agent": "BAOU-Notification-Monitor/1.0",
      },
    });

    const $ = cheerio.load(response.data);
    const notifications = [];

    $(".dpul li").each((_, element) => {
      // Get the link if it exists
      const linkElement = $(element).find("a");
      const link = linkElement.length > 0 ? linkElement.attr("href") : null;

      // Process the text
      let text = $(element).clone().find("img").remove().end().text().trim();

      const notification = {
        id: generateNotificationId(text, new Date().toISOString()),
        text,
        link: link ? new URL(link, "https://baou.edu.in").href : null,
        isNew: $(element).find('img.blk[src*="baou_new.gif"]').length > 0,
        isUrgent: detectUrgency(text),
        timestamp: new Date().toISOString(),
        category: categorizeNotification(text),
      };

      notifications.push(notification);
    });

    return notifications;
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
    }
    return null;
  }
}

async function loadPreviousNotifications() {
  try {
    const data = await readFile(CONFIG.storageFile, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Error loading previous notifications:", error.message);
    }
    return [];
  }
}

async function saveNotifications(notifications) {
  try {
    const backupFile = `${CONFIG.storageFile}.backup`;
    await writeFile(backupFile, JSON.stringify(notifications, null, 2));
    await writeFile(CONFIG.storageFile, JSON.stringify(notifications, null, 2));
  } catch (error) {
    console.error("Error saving notifications:", error.message);
  }
}

async function sendEmailNotification(newNotifications) {
  console.log("Preparing to send enhanced email notification...");

  const emailContent = generateEmailHTML(newNotifications);

  const emailData = {
    from: CONFIG.email.from,
    to: [CONFIG.email.to],
    replyTo: CONFIG.email.replyTo,
    subject: `BAOU: ${newNotifications.length} New Notification${
      newNotifications.length !== 1 ? "s" : ""
    }${newNotifications.some((n) => n.isUrgent) ? " (URGENT)" : ""}`,
    html: emailContent,
  };

  try {
    const {
      data: { id },
    } = await resend.emails.send(emailData);
    console.log("Email sent successfully with ID:", id);
    return true;
  } catch (error) {
    console.error("Failed to send email:", error.message);
    if (error.response) {
      console.error("API Response:", error.response.data);
    }
    return false;
  }
}

async function monitorNotifications() {
  console.log(
    `[${new Date().toISOString()}] Checking for new notifications...`
  );

  const previousNotifications = await loadPreviousNotifications();
  const currentNotifications = await fetchNotifications();

  if (!currentNotifications) {
    console.log("Failed to fetch notifications. Will retry next time.");
    return;
  }

  const newNotifications = currentNotifications.filter((current) => {
    return !previousNotifications.some(
      (prev) =>
        prev.id === current.id ||
        (prev.text === current.text &&
          new Date(prev.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000))
    );
  });

  if (newNotifications.length > 0) {
    console.log(`Found ${newNotifications.length} new notifications`);
    const emailSent = await sendEmailNotification(newNotifications);
    if (emailSent) {
      await saveNotifications([...newNotifications, ...previousNotifications]);
    }
  } else {
    console.log("No new notifications found");
  }
}

async function startMonitoring() {
  console.log("Starting enhanced BAOU notification monitoring service...");
  console.log(
    `Configuration: Check interval = ${CONFIG.checkInterval / 1000} seconds`
  );

  // Create initial storage file if it doesn't exist
  try {
    await loadPreviousNotifications();
  } catch (error) {
    await saveNotifications([]);
  }

  try {
    // Initial check
    await monitorNotifications();

    // Set up periodic monitoring
    setInterval(() => {
      monitorNotifications().catch((error) => {
        console.error("Error in monitoring cycle:", error.message);
      });
    }, CONFIG.checkInterval);

    // Set up error handling
    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
    });
  } catch (error) {
    console.error("Fatal error in monitoring service:", error);
    process.exit(1);
  }
}

// Start the monitoring service
startMonitoring();
