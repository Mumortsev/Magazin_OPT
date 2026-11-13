# Keep Firebase Messaging
-keep class com.google.firebase.messaging.** { *; }
-keep public class * extends com.google.firebase.messaging.FirebaseMessagingService

# Keep WebView Javascript Interface if any
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes Signature,InnerClasses,EnclosingMethod

# Keep Compose/Kotlin Serialization if applicable
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
