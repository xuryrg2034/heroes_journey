using TMPro;
using UnityEngine;

namespace Entities.Player
{
    public class HeroUIService : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] TextMeshProUGUI power;
        [SerializeField] TextMeshProUGUI energy;
        [SerializeField] TextMeshProUGUI health;
        
        Hero _hero;

        public void Init(Hero hero)
        {
            _hero = hero;
            
            _updatePower(_hero.Damage.Value);
            _updateEnergy(_hero.Energy.Value);
            _updateHealth(_hero.Health.Value);

            _hero.Energy.OnValueChanged.AddListener(_updateEnergy);
            _hero.Damage.OnValueChanged.AddListener(_updatePower);
            _hero.Health.OnValueChanged.AddListener(_updateHealth);
        }

        void _updatePower(int value)
        {
            power.text = $"Power: {value}";
        }
        
        void _updateHealth(int value)
        {
            health.text = $"Health: {value}";
        }
        
        void _updateEnergy(int value)
        {
            energy.text = $"Energy: {value}";
        }

        // void _showPower(int value)
        // {
        //     heroPower.text = $"Power: {value}";
        // }
    }
}