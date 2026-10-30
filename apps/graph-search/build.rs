fn main() {
    // SQLx tracks existing migration contents; also rebuild when a file is added.
    println!("cargo:rerun-if-changed=migrations");
}
