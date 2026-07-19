use tauri::utils::acl::RemoteUrlPattern;

#[test]
fn follow_mode_capability_covers_dynamic_server_ports() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/remote.json")).unwrap();
    let patterns = capability["remote"]["urls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().parse::<RemoteUrlPattern>().unwrap())
        .collect::<Vec<_>>();

    for url in [
        "http://127.0.0.1:43110/",
        "http://192.168.1.5:43110/",
        "https://stream.example.com/",
        "https://stream.example.com:8443/",
    ] {
        let parsed = url.parse().unwrap();
        assert!(
            patterns.iter().any(|pattern| pattern.test(&parsed)),
            "follow-mode capability did not match {url}",
        );
    }
}
