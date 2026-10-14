export function VoxelScene() {
  return (
    <svg
      className="voxel-scene"
      viewBox="0 0 360 230"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 188 180 96 340 188 180 280Z"
        stroke="#AC88F6"
        strokeOpacity=".16"
      />
      {[0, 1, 2, 3].map((n) => (
        <g key={n} opacity=".12">
          <path
            d={`M${60 + n * 40} ${165 - n * 23}l160 92M${60 + n * 40} ${211 + n * 23}l160-92`}
            stroke="#AC88F6"
          />
        </g>
      ))}
      <g transform="translate(155 24)">
        <path d="m0 25 44-25 44 25-44 25Z" fill="#AC88F6" />
        <path d="m0 25 44 25v66L0 91Z" fill="#7557B0" />
        <path d="m44 50 44-25v66l-44 25Z" fill="#8D69D0" />
        <path d="m11 44 20 12v18L11 62Z" fill="#222222" opacity=".35" />
        <path d="m56 55 19-11v18L56 73Z" fill="#222222" opacity=".35" />
      </g>
      <g transform="translate(91 102)">
        <path d="m0 24 43-24 43 24-43 25Z" fill="#B8FEBF" />
        <path d="m0 24 43 25v51L0 76Z" fill="#659A70" />
        <path d="m43 49 43-25v52l-43 24Z" fill="#87C78E" />
        <path d="m0 37 43 25 43-25" stroke="#1A1A1A" strokeOpacity=".22" />
      </g>
      <g transform="translate(196 112)">
        <path d="m0 21 37-21 37 21-37 22Z" fill="#464646" />
        <path d="m0 21 37 22v47L0 68Z" fill="#292929" />
        <path d="m37 43 37-22v47l-37 22Z" fill="#363636" />
        <path d="m0 21 37 22 37-22" stroke="#AC88F6" strokeOpacity=".5" />
      </g>
      <path d="m98 42 7-4 7 4-7 4Z" fill="#B8FEBF" />
      <path d="m276 86 9-5 9 5-9 5Z" fill="#AC88F6" />
    </svg>
  );
}
