using TMPro;
using UnityEngine;
using DG.Tweening;

namespace Core.Entities
{
    public class RainbowReward : Entity
    {
        private SpriteRenderer _sr;
        private TextMeshPro _healthUI;
        private Tween _tween;

        public override void Init()
        {
            base.Init();

            _sr = GetComponent<SpriteRenderer>();
            
            _rainbowAnimation();
        }

        private void OnDestroy()
        {
            _tween.Kill();
        }

        private void _rainbowAnimation()
        {
            _tween = DOTween.To(() => 0f, 
                    (value) => _sr.color = Color.HSVToRGB(value, 1f, 1f), 
                    1f, 0.3f)
                .SetLoops(-1, LoopType.Restart)
                .SetEase(Ease.Linear);
        }
    }
}