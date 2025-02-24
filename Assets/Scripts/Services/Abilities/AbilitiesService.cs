using Abilities.HeroAbilities;
using DG.Tweening;
using UnityEngine;

namespace Services.Abilities
{
    public class AbilitiesService : MonoBehaviour
    {
        public BaseAbility[] AbilitiesList { get; private set; }

        public static AbilitiesService Instance;
        
        private BaseAbility _selectedAbility;

        private void Awake() {
            if (Instance == null) {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            } else {
                Destroy(gameObject);
            }
        }
        
        public void Init(BaseAbility[] abilitiesList)
        {
            AbilitiesList = abilitiesList;
        }
        
        public void SelectAbility(BaseAbility ability)
        {
            ResetAbilities();

            _selectedAbility = ability;
            _selectedAbility.Activate();
        }

        public void ResetAbilities()
        {
            _selectedAbility?.Deactivate();
            _selectedAbility = null;
        }

        public Tween Execute()
        {
            if (_selectedAbility == null)
            {
                return default;
            }
            return _selectedAbility?.Execute();
        }
    }
}