use std::process::Command;

fn main() {
    // SQLx tracks existing migration contents; also rebuild when a file is added.
    println!("cargo:rerun-if-changed=migrations");

    // ONNX Runtime's prebuilt macOS library calls clang's availability helper
    // (`__isPlatformVersionAtLeast`), which Rust does not link by default.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let output = Command::new("cc")
            .arg("--print-runtime-dir")
            .output()
            .expect("run cc --print-runtime-dir; install the Xcode Command Line Tools");
        let runtime_dir = String::from_utf8(output.stdout).expect("cc prints a UTF-8 path");
        println!("cargo:rustc-link-search=native={}", runtime_dir.trim());
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
}
