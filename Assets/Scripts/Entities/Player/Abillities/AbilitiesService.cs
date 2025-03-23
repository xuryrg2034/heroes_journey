using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Player
{
    public class AbilitiesService : MonoBehaviour
    {
        private List<BaseAbility> _abilitiesList;

        public List<BaseAbility> AbilitiesList => _abilitiesList;
        
        private BaseAbility _selectedAbility;
        
        public BaseAbility SelectedAbility => _selectedAbility;
        
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