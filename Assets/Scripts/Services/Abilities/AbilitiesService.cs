using System.Collections.Generic;
using Abilities.Hero;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;
using UnityEngine.Events;

namespace Services.Abilities
{
    public class AbilitiesService : MonoBehaviour
    {
        public static AbilitiesService Instance;
     
        private List<BaseAbility> _abilitiesList;

        public List<BaseAbility> AbilitiesList => _abilitiesList;
        
        private BaseAbility _selectedAbility;

        private void Awake() {
            if (Instance == null) {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            } else {
                Destroy(gameObject);
            }
        }
        
        public void Init(List<BaseAbility> abilitiesList)
        {
            _abilitiesList = abilitiesList;
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

        public async UniTask Execute()
        {
            if (_selectedAbility == null)
            {
                return;
            }
            
            await _selectedAbility.Execute();
        }
    }
}