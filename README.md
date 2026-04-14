# 🚨 পুলিশ অ্যালার্ট লাইভ ম্যাপ v2.0
Real-time Multi-device — Community Police Alert Map — Bangladesh

## 🔥 Firebase সেটআপ (বিনামূল্যে, ১৫ মিনিট)

### ধাপ ১ — Firebase প্রজেক্ট
1. console.firebase.google.com → "Add project"
2. নাম দিন → Create

### ধাপ ২ — Realtime Database
1. Build → Realtime Database → Create database
2. Location: Singapore → Start in test mode → Enable

### ধাপ ৩ — Web App
1. Project Overview → "</>" Web icon → Register app
2. firebaseConfig কপি করুন

### ধাপ ৪ — অ্যাপে দিন
1. ওয়েবসাইট খুলুন → Setup Wizard
2. firebaseConfig পেস্ট করুন → সংরক্ষণ করুন

## Security Rules (Production)
Firebase Console → Realtime Database → Rules:
{
  "rules": {
    "markers": {
      ".read": true,
      ".write": true
    }
  }
}

## ডিপ্লয়মেন্ট

Netlify (সহজ): app.netlify.com/drop → ফোল্ডার drag করুন

GitHub Pages: repo তৈরি → Settings → Pages → main branch

Firebase Hosting:
  npm install -g firebase-tools
  firebase login && firebase init hosting && firebase deploy

## কাস্টমাইজেশন
js/app.js এর CONFIG:
  DEFAULT_LAT/LNG — শহর পরিবর্তন
  WRONG_THRESHOLD — কত ভুল রিপোর্টে হাইড (ডিফল্ট: ৫)

শহরের কোঅর্ডিনেট:
  ঢাকা:      23.8103, 90.4125
  চট্টগ্রাম:  22.3569, 91.7832
  সিলেট:    24.8949, 91.8687
  রাজশাহী:  24.3636, 88.6241
