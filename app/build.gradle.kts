import org.jetbrains.kotlin.gradle.tasks.KotlinCompile
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.flowork.os"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.flowork.os"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            // [DIPERBAIKI] Diubah menjadi true untuk membuang kode Kotlin/Java bawaan yang tak terpakai
            isMinifyEnabled = true
            // [DIPERBAIKI] Diaktifkan untuk men-drop resource XML/gambar yang tak terpakai (Zombie)
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // [DIHAPUS] Bagian kotlinOptions ini yang bikin warning deprecated
    // kotlinOptions {
    //     jvmTarget = "17"
    // }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.activity.ktx)

    // CameraX
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    // Flowork Hybrid Engine
    // [DIPERBAIKI - KOMENTAR ZOMBIE CODE]
    // Library di bawah ini di-comment karena UI aplikasi 100% menggunakan WebView (engine.html).
    // Mematikan library ini akan memangkas ukuran APK secara drastis tanpa menghapus kodenya.
    // implementation("com.squareup.retrofit2:retrofit:2.9.0")
    // implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    // implementation("io.coil-kt:coil:2.6.0")
    // implementation("io.coil-kt:coil-svg:2.6.0")
    // implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}

// [BARU] Konfigurasi pengganti kotlinOptions yang benar
tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}