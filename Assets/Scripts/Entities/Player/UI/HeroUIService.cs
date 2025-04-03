using TMPro;
using UnityEngine;

namespace Entities.Player
{
    public class HeroUIService : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] EnergyUI energy;
        [SerializeField] TextMeshProUGUI health;
        
        Hero _hero;

        public void Init(Hero hero)
        {
            _hero = hero;
            
            energy.Initialize(_hero.Energy);
            _updateHealth(_hero.Health.Value);
            _hero.Health.OnValueChanged.AddListener(_updateHealth);
        }
        
        void _updateHealth(int value)
        {
            health.text = $"Health: {value}";
        }
    }
}