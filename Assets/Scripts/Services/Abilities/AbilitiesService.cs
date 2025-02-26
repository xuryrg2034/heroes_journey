using System.Collections.Generic;
using Abilities.Hero;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;

namespace Services.Abilities
{
    public class AbilitiesService : MonoBehaviour
    {
        public List<BaseAbility> AbilitiesList { get; private set; }

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
        
        public void Init(List<BaseAbility> abilitiesList)
        {
            AbilitiesList = abilitiesList;
            // abilitiesList[0].Activate();
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
                return ;
            }
            
            await _selectedAbility.Execute();
        }
    }
}